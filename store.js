// All people and relations, kept in memory and in localStorage.
// meta/version = time of the last change; every write here updates it (the rules require that).

import { db, myEmail } from "./firebase.js";
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
let files = new Map();     // id -> { id, title, kind, source, people, ..., updatedAt (ms) }
let categories = new Map(); // id -> { id, name }
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

export function getFile(id) {
    return files.get(id) ?? null;
}

export function getFiles() {
    return [...files.values()];
}

export function getCategories() {
    return [...categories.values()].sort((a, b) => a.name.localeCompare(b.name));
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
        files = new Map((cached.files ?? []).map((f) => [f.id, f]));
        categories = new Map((cached.categories ?? []).map((c) => [c.id, c]));
        return;
    }

    console.log("store: downloading everything");
    const [personSnap, relationSnap, settingsSnap, fileSnap, categorySnap] = await Promise.all([
        getDocs(collection(db, "persons")),
        getDocs(collection(db, "relations")),
        getDoc(settingsRef),
        getDocs(collection(db, "files")),
        getDocs(collection(db, "categories")),
    ]);
    version = serverVersion;
    persons = new Map(personSnap.docs.map((d) => [d.id, fromDoc(d)]));
    relations = new Map(relationSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    settings = settingsSnap.exists() ? settingsSnap.data() : {};
    files = new Map(fileSnap.docs.map((d) => [d.id, fromDoc(d)]));
    categories = new Map(categorySnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    writeCache();
}

// Firestore Timestamps can't go into JSON, so updatedAt is kept as milliseconds
function fromDoc(d) {
    const data = d.data();
    const result = { id: d.id, ...data, updatedAt: data.updatedAt?.toMillis() ?? 0 };
    if (data.createdAt) result.createdAt = data.createdAt.toMillis(); // files: when it was uploaded
    return result;
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
            files: getFiles(),
            categories: getCategories(),
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

// date = "YYYY", "YYYY-MM", "YYYY-MM-DD" or null; place = text or null. null removes it.
export async function setWedding(id, date, place) {
    await commit((batch) => batch.update(doc(db, "relations", id), {
        weddingDate: date ?? deleteField(),
        weddingPlace: place ?? deleteField(),
    }));

    const relation = { ...relations.get(id) };
    for (const [key, value] of [["weddingDate", date], ["weddingPlace", place]]) {
        if (value) relation[key] = value;
        else delete relation[key];
    }
    relations.set(id, relation);
    writeCache();
}

// ---------- Settings ----------

export async function setHomePerson(id) {
    await commit((batch) => batch.set(settingsRef, { homePerson: id }));

    settings = { ...settings, homePerson: id };
    writeCache();
}

// ---------- Files ----------

// The id is made up front, because the Storage paths (files/<id>/...) are needed before the document is saved
export function newFileId() {
    return doc(collection(db, "files")).id;
}

// isNew: also stores when it was uploaded and by whom (your email = the id of your user document).
// Editing only changes the form's fields, so createdAt and uploadedBy are never touched (the rules check that).
export async function saveFile(id, data, { isNew }) {
    const ref = doc(db, "files", id);
    const { createdAt, uploadedBy, ...fields } = data;

    if (isNew) {
        await commit((batch) => batch.set(ref, { ...fields, createdAt: serverTimestamp(), uploadedBy: myEmail(), updatedAt: serverTimestamp() }));
        files.set(id, { id, ...fields, createdAt: Date.now(), uploadedBy: myEmail(), updatedAt: Date.now() });
    } else {
        const update = { ...fields, updatedAt: serverTimestamp() };
        for (const key of ["description", "date", "category"]) {
            if (!(key in fields)) update[key] = deleteField(); // cleared on the form
        }
        await commit((batch) => batch.update(ref, update));

        const old = files.get(id);
        const kept = {};
        if (old.createdAt) kept.createdAt = old.createdAt;
        if (old.uploadedBy) kept.uploadedBy = old.uploadedBy;
        files.set(id, { id, ...kept, ...fields, updatedAt: Date.now() });
    }
    writeCache();
}

// Also takes the photo away as profile photo from anyone using it, in the same batch
export async function deleteFile(id) {
    const users = getPersons().filter((p) => p.photo?.file === id);
    await commit((batch) => {
        batch.delete(doc(db, "files", id));
        users.forEach((p) => batch.update(doc(db, "persons", p.id), { photo: deleteField(), updatedAt: serverTimestamp() }));
    });

    files.delete(id);
    users.forEach((p) => persons.set(p.id, withoutPhoto(p)));
    writeCache();
}

// photo = { file, avatar }, or null to remove the profile photo
export async function setProfilePhoto(personId, photo) {
    const update = { photo: photo ?? deleteField(), updatedAt: serverTimestamp() };
    await commit((batch) => batch.update(doc(db, "persons", personId), update));

    const p = persons.get(personId);
    persons.set(personId, photo ? { ...p, photo, updatedAt: Date.now() } : withoutPhoto(p));
    writeCache();
}

function withoutPhoto(p) {
    const { photo, ...rest } = p;
    return { ...rest, updatedAt: Date.now() };
}

// ---------- File categories ----------

export async function addCategory(name) {
    const ref = doc(collection(db, "categories"));
    await commit((batch) => batch.set(ref, { name }));

    categories.set(ref.id, { id: ref.id, name });
    writeCache();
    return ref.id;
}

export async function renameCategory(id, name) {
    await commit((batch) => batch.set(doc(db, "categories", id), { name }));

    categories.set(id, { id, name });
    writeCache();
}

// The files in it become uncategorized, in the same batch, so no file points to a missing category
export async function deleteCategory(id) {
    const inIt = getFiles().filter((f) => f.category === id);
    await commit((batch) => {
        batch.delete(doc(db, "categories", id));
        inIt.forEach((f) => batch.update(doc(db, "files", f.id), { category: deleteField(), updatedAt: serverTimestamp() }));
    });

    categories.delete(id);
    inIt.forEach((f) => {
        const { category, ...rest } = f;
        files.set(f.id, { ...rest, updatedAt: Date.now() });
    });
    writeCache();
}
