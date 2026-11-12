// All people and relations, kept in memory and in localStorage.
// meta/version = time of the last change; every write here updates it (the rules require that).

import { db } from "./firebase.js";
import { collection, doc, getDoc, getDocs, query, where, writeBatch, serverTimestamp }
    from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const CACHE_KEY = "family-tree-cache";
const versionRef = doc(db, "meta", "version");

let version = null;
let persons = new Map();   // id -> { id, givenNames, surname, ..., updatedAt (ms) }
let relations = new Map(); // id -> { id, personA, personB, type, weddingDate? }
let loading = null;

// ---------- Reading ----------

export function getPerson(id) {
    return persons.get(id) ?? null;
}

export function getPersons() {
    return [...persons.values()];
}

export function getRelations() {
    return [...relations.values()];
}

// Call once before showing any screen. Calling it again returns the same promise.
export function loadStore() {
    loading ??= load();
    return loading;
}

async function load() {
    const meta = await getDoc(versionRef);
    const serverVersion = meta.exists() ? meta.data().updatedAt.toMillis() : 0;

    const cached = readCache();
    if (cached?.version === serverVersion) {
        console.log("store: using cache");
        version = cached.version;
        persons = new Map(cached.persons.map((p) => [p.id, p]));
        relations = new Map(cached.relations.map((r) => [r.id, r]));
        return;
    }

    console.log("store: downloading everything");
    const [personSnap, relationSnap] = await Promise.all([
        getDocs(collection(db, "persons")),
        getDocs(collection(db, "relations")),
    ]);
    version = serverVersion;
    persons = new Map(personSnap.docs.map((d) => [d.id, fromDoc(d)]));
    relations = new Map(relationSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    writeCache();
}

// Firestore Timestamps can't go into JSON, so updatedAt is kept as milliseconds
function fromDoc(d) {
    const data = d.data();
    return { id: d.id, ...data, updatedAt: data.updatedAt?.toMillis() ?? 0 };
}

// ---------- Cache ----------

function readCache() {
    try {
        return JSON.parse(localStorage.getItem(CACHE_KEY));
    } catch {
        return null;
    }
}

function writeCache() {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
            version,
            persons: getPersons(),
            relations: getRelations(),
        }));
    } catch (error) {
        console.warn("store: could not write cache", error); // e.g. storage full; the site still works
    }
}

// On sign-out, so the family data doesn't stay behind on a shared computer
export function clearCache() {
    try {
        localStorage.removeItem(CACHE_KEY);
    } catch { }
}

// ---------- Writing ----------

// After a write, memory and cache are updated by hand but `version` stays old,
// so the next page load downloads everything once.
async function commit(addWrites) {
    const batch = writeBatch(db);
    addWrites(batch);
    batch.set(versionRef, { updatedAt: serverTimestamp() });
    await batch.commit();
}

// id = null adds a new person. Returns the id.
export async function savePerson(id, data) {
    const ref = id ? doc(db, "persons", id) : doc(collection(db, "persons"));
    await commit((batch) => batch.set(ref, { ...data, updatedAt: serverTimestamp() }));

    persons.set(ref.id, { id: ref.id, ...data, updatedAt: Date.now() });
    writeCache();
    return ref.id;
}

// Deletes the person and every relation they are in, all or nothing
export async function deletePerson(id) {
    // Asked from the server rather than memory, in case another admin just added a relation
    const col = collection(db, "relations");
    const [asA, asB] = await Promise.all([
        getDocs(query(col, where("personA", "==", id))),
        getDocs(query(col, where("personB", "==", id))),
    ]);
    const relationDocs = [...asA.docs, ...asB.docs];

    await commit((batch) => {
        batch.delete(doc(db, "persons", id));
        relationDocs.forEach((d) => batch.delete(d.ref));
    });

    persons.delete(id);
    relationDocs.forEach((d) => relations.delete(d.id));
    writeCache();
}
