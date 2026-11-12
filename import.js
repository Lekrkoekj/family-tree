// One-off import of a GEDCOM export (Heritage Family Tree Deluxe) into Firestore.
// Temporary: delete import.html and import.js once the data is in.

import { auth, db, getUserData } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { collection, doc, getDocs, writeBatch, serverTimestamp }
    from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { clearCache } from "./store.js";

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

// Corrections decided by hand for this particular file
const SKIP = new Set(["@I104@"]);                       // an empty record: no name, gender or family
const NAME_IN_SURNAME_FIELD = new Set(["@I98@"]);       // "/Jacob/" is a given name, not a surname

// ---------- Reading the file ----------

// GEDCOM is lines of "level [@id@] TAG [value]". Turns them into a tree of { tag, id, value, children }.
export function parseGedcom(text) {
    const root = { children: [] };
    const stack = [root];
    for (const raw of text.split(/\r?\n/)) {
        const m = /^(\d+) (?:(@[^@]+@) )?(\S+)(?: (.*))?$/.exec(raw.trim());
        if (!m) continue;
        const level = Number(m[1]);
        const node = { tag: m[3], id: m[2] ?? null, value: m[4] ?? "", children: [] };
        stack.length = level + 1; // drop deeper levels we've left
        stack[level].children.push(node);
        stack[level + 1] = node;
    }
    return root.children;
}

const child = (node, tag) => node.children.find((c) => c.tag === tag);
const children = (node, tag) => node.children.filter((c) => c.tag === tag);

// "29 MAY 1943" -> "1943-05-29", "MAY 1943" -> "1943-05", "1818?" -> "1818". Anything else: null.
export function convertDate(value) {
    const parts = value.replace(/\?/g, "").trim().toUpperCase().split(/\s+/);
    const year = parts.at(-1);
    if (!/^\d{4}$/.test(year)) return null;
    if (parts.length === 1) return year;

    const month = MONTHS[parts.at(-2)];
    if (!month) return null;
    const mm = String(month).padStart(2, "0");
    if (parts.length === 2) return year + "-" + mm;

    const day = Number(parts.at(-3));
    if (parts.length !== 3 || !(day >= 1 && day <= 31)) return null;
    return year + "-" + mm + "-" + String(day).padStart(2, "0");
}

// ---------- Converting to our data model ----------

// Returns { persons: [{ ref, data }], relations: [{ id, data }], warnings: [...] }.
// ref is the GEDCOM id (@I1@); newId(ref) gives the Firestore id to use for that person.
export function convertGedcom(records, newId) {
    const warnings = [];
    const ids = new Map(); // GEDCOM id -> Firestore id
    const persons = [];
    const marriageOnPerson = new Map(); // GEDCOM person id -> wedding date stored on the person (MARC)

    for (const indi of records.filter((r) => r.tag === "INDI")) {
        if (SKIP.has(indi.id)) continue;
        const nameNode = child(indi, "NAME");
        const raw = nameNode?.value ?? "";
        let givenNames = raw.split("/")[0].trim();
        let surname = (raw.split("/")[1] ?? "").trim();
        if (NAME_IN_SURNAME_FIELD.has(indi.id)) [givenNames, surname] = [surname, ""];
        if (!givenNames && !surname) {
            warnings.push(indi.id + " has no name and was skipped");
            continue;
        }

        const sex = child(indi, "SEX")?.value;
        const data = { gender: sex === "M" ? "male" : sex === "F" ? "female" : "other" };
        if (givenNames) data.givenNames = givenNames.slice(0, 100);
        if (surname) data.surname = surname.slice(0, 50);
        const nick = nameNode && child(nameNode, "NICK")?.value.trim();
        if (nick) data.nickname = nick.slice(0, 50);

        const birth = dateOf(indi, "BIRT", warnings);
        if (birth) data.birthDate = birth;
        const death = child(indi, "DEAT");
        if (death) {
            data.deceased = true;
            const date = dateOf(indi, "DEAT", warnings);
            if (date) data.deathDate = date;
        }
        const marc = dateOf(indi, "MARC", warnings);
        if (marc) marriageOnPerson.set(indi.id, marc);

        ids.set(indi.id, newId(indi.id));
        persons.push({ ref: indi.id, data });
    }

    // Families: husband + wife become partners; each child gets a parent-child relation per parent
    const relations = new Map();
    const add = (personA, personB, type, extra = {}) => {
        const id = personA + "_" + personB;
        if (!relations.has(id)) relations.set(id, { id, data: { personA, personB, type, ...extra } });
    };

    for (const fam of records.filter((r) => r.tag === "FAM")) {
        const parents = ["HUSB", "WIFE"].map((t) => child(fam, t)?.value).filter((ref) => ids.has(ref)).map((ref) => ids.get(ref));
        const kids = children(fam, "CHIL").map((c) => c.value).filter((ref) => ids.has(ref)).map((ref) => ids.get(ref));

        if (parents.length === 2) {
            const [a, b] = [...parents].sort();
            const wedding = dateOf(fam, "MARR", warnings) ?? weddingFromPerson(fam, marriageOnPerson, records);
            add(a, b, "partner", wedding ? { weddingDate: wedding } : {});
        }
        for (const p of parents) for (const k of kids) add(p, k, "parent-child");
    }

    return { persons: persons.map((p) => ({ ...p, id: ids.get(p.ref) })), relations: [...relations.values()], warnings };
}

function dateOf(node, eventTag, warnings) {
    const value = child(node, eventTag) && child(child(node, eventTag), "DATE")?.value;
    if (!value) return null;
    const date = convertDate(value);
    if (!date) warnings.push(node.id + " " + eventTag + ': could not read date "' + value + '"');
    return date;
}

// A wedding date stored on one of the spouses instead of the family, used if that spouse has only this family
function weddingFromPerson(fam, marriageOnPerson, records) {
    for (const t of ["HUSB", "WIFE"]) {
        const ref = child(fam, t)?.value;
        if (!marriageOnPerson.has(ref)) continue;
        const indi = records.find((r) => r.id === ref);
        if (children(indi, "FAMS").length === 1) return marriageOnPerson.get(ref);
    }
    return null;
}

// ---------- Writing ----------

const RELATIONS_PER_BATCH = 8; // each relation makes the rules look up 2 people; Firestore allows ~20 lookups per batch
const OTHERS_PER_BATCH = 400;

async function commitInBatches(items, size, addToBatch, log, label) {
    for (let i = 0; i < items.length; i += size) {
        const batch = writeBatch(db);
        items.slice(i, i + size).forEach((item) => addToBatch(batch, item));
        batch.set(doc(db, "meta", "version"), { updatedAt: serverTimestamp() }); // the rules require this in every batch
        await batch.commit();
        log(label + ": " + Math.min(i + size, items.length) + " / " + items.length);
    }
}

async function runImport(plan, existing, log) {
    await commitInBatches(existing.relations, OTHERS_PER_BATCH, (b, d) => b.delete(d.ref), log, "Deleting old relations");
    await commitInBatches(existing.persons, OTHERS_PER_BATCH, (b, d) => b.delete(d.ref), log, "Deleting old people");
    await commitInBatches(plan.persons, OTHERS_PER_BATCH,
        (b, p) => b.set(doc(db, "persons", p.id), { ...p.data, updatedAt: serverTimestamp() }), log, "Creating people");
    await commitInBatches(plan.relations, RELATIONS_PER_BATCH,
        (b, r) => b.set(doc(db, "relations", r.id), r.data), log, "Creating relations");
    clearCache();
}

// ---------- The page ----------

const $ = (id) => document.getElementById(id);

function log(line) {
    $("log").textContent += line + "\n";
}

export function initImportPage() {
    onAuthStateChanged(auth, async (user) => {
        const role = user ? (await getUserData(user))?.role : null;
        if (role !== "admin") {
            $("status").textContent = "Only admins can use this page. Sign in on the main site first.";
            return;
        }
        $("status").textContent = "Signed in as " + user.email + ". Choose the .ged file.";
        $("file").disabled = false;
    });

    $("file").onchange = async () => {
        const file = $("file").files[0];
        if (!file) return;
        $("log").textContent = "";
        const plan = convertGedcom(parseGedcom(await file.text()), () => doc(collection(db, "persons")).id);
        const [persons, relations] = await Promise.all([getDocs(collection(db, "persons")), getDocs(collection(db, "relations"))]);
        const existing = { persons: persons.docs, relations: relations.docs };

        log("Will DELETE: " + existing.persons.length + " people and " + existing.relations.length + " relations (users are kept)");
        log("Will CREATE: " + plan.persons.length + " people and " + plan.relations.length + " relations");
        plan.warnings.forEach((w) => log("Warning: " + w));

        $("run").hidden = false;
        $("run").onclick = async () => {
            if (!confirm("Delete " + existing.persons.length + " people and " + existing.relations.length
                + " relations, then import " + plan.persons.length + " people? Deleting can't be undone.")) return;
            $("run").disabled = $("file").disabled = true;
            try {
                await runImport(plan, existing, log);
                log("Done! Open the main site to see the family tree.");
            } catch (error) {
                console.error(error);
                log("Stopped with an error: " + (error.code ?? error.message) + ". Choose the file again to retry from the start.");
                $("file").disabled = false;
            }
        };
    };
}
