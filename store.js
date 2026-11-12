// All people and relations, kept in memory and in localStorage.
// meta/version = time of the last change; every write here updates it (the rules require that).

import { db } from "./firebase.js";
import { collection, doc, getDoc, getDocs, query, where, writeBatch, serverTimestamp, deleteField }
    from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const CACHE_KEY = "family-tree-cache";
const LAST_SELECTED_KEY = "family-tree-last-selected";
const versionRef = doc(db, "meta", "version");
const settingsRef = doc(db, "meta", "settings");

let version = null;
let persons = new Map();   // id -> { id, givenNames, surname, ..., updatedAt (ms) }
let relations = new Map(); // id -> { id, personA, personB, type, weddingDate? }
let settings = {};         // { homePerson? }
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

export function getHomePersonId() {
    return settings.homePerson ?? null;
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
        settings = cached.settings ?? {};
        return;
    }

    console.log("store: downloading everything");
    const [personSnap, relationSnap, settingsSnap] = await Promise.all([
        getDocs(collection(db, "persons")),
        getDocs(collection(db, "relations")),
        getDoc(settingsRef),
    ]);
    version = serverVersion;
    persons = new Map(personSnap.docs.map((d) => [d.id, fromDoc(d)]));
    relations = new Map(relationSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    settings = settingsSnap.exists() ? settingsSnap.data() : {};
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
            settings,
        }));
    } catch (error) {
        console.warn("store: could not write cache", error); // e.g. storage full; the site still works
    }
}

// On sign-out, so the family data doesn't stay behind on a shared computer
export function clearCache() {
    try {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(LAST_SELECTED_KEY);
    } catch { }
}

// ---------- Last selected person in the tree (per browser) ----------

export function getLastSelected() {
    try {
        return localStorage.getItem(LAST_SELECTED_KEY);
    } catch {
        return null;
    }
}

export function setLastSelected(id) {
    try {
        localStorage.setItem(LAST_SELECTED_KEY, id);
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

// ---------- Relations ----------

// kind is seen from personId: "parent" = otherId is their parent, "child" = otherId is their child.
// In parent-child, personA is the parent. Partners are stored with the ids sorted, so there is one per couple.
export function makeRelation(personId, kind, otherId) {
    let relation;
    if (kind === "parent") relation = { personA: otherId, personB: personId, type: "parent-child" };
    else if (kind === "child") relation = { personA: personId, personB: otherId, type: "parent-child" };
    else {
        const [a, b] = [personId, otherId].sort();
        relation = { personA: a, personB: b, type: "partner" };
    }
    return { id: relation.personA + "_" + relation.personB, ...relation };
}

export async function addRelation(relation) {
    const { id, ...data } = relation;
    await commit((batch) => batch.set(doc(db, "relations", id), data));

    relations.set(id, relation);
    writeCache();
}

// Creates a new person and their relation in one batch. Returns the new person's id.
export async function addPersonWithRelation(personData, personId, kind) {
    const ref = doc(collection(db, "persons"));
    const relation = makeRelation(personId, kind, ref.id);
    const { id, ...relationData } = relation;

    await commit((batch) => {
        batch.set(ref, { ...personData, updatedAt: serverTimestamp() });
        batch.set(doc(db, "relations", id), relationData);
    });

    persons.set(ref.id, { id: ref.id, ...personData, updatedAt: Date.now() });
    relations.set(id, relation);
    writeCache();
    return ref.id;
}

export async function removeRelation(id) {
    await commit((batch) => batch.delete(doc(db, "relations", id)));

    relations.delete(id);
    writeCache();
}

// date = "YYYY", "YYYY-MM", "YYYY-MM-DD", or null to remove it
export async function setWeddingDate(id, date) {
    await commit((batch) => batch.update(doc(db, "relations", id), { weddingDate: date ?? deleteField() }));

    const relation = { ...relations.get(id) };
    if (date) relation.weddingDate = date;
    else delete relation.weddingDate;
    relations.set(id, relation);
    writeCache();
}

// ---------- Settings ----------

export async function setHomePerson(id) {
    await commit((batch) => batch.set(settingsRef, { homePerson: id }));

    settings = { ...settings, homePerson: id };
    writeCache();
}
