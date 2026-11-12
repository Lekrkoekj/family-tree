// Admin tools on the person details page: adding/removing relatives and the wedding date.

import { $, showError, friendlyError } from "./ui.js";
import { lifespan, readDate, fillDate } from "./dates.js";
import {
    getPerson, getPersons, getRelations, makeRelation,
    addRelation, addPersonWithRelation, removeRelation, setWeddingDate
} from "./store.js";
import { fullName, compareByName } from "./names.js";

const RECENT_COUNT = 10;
const MAX_RESULTS = 20;

let picker = null;  // { personId, kind, onDone } while the picker is open
let wedding = null; // { relationId, onDone } while the wedding dialog is open
let busy = false;

export function initRelations() {
    $("picker-search").oninput = renderResults;
    $("picker-new-back").onclick = showSearch;
    $("picker-new-form").onsubmit = submitNewPerson;
    $("picker-cancel").onclick = () => $("picker-dialog").close();

    $("wedding-form").onsubmit = submitWedding;
    $("wedding-cancel").onclick = () => $("wedding-dialog").close();
}

// ---------- Picker ----------

// kind = "parent" | "partner" | "child", seen from personId. onDone runs after a successful save.
export function openPicker(personId, kind, onDone) {
    picker = { personId, kind, onDone };
    $("picker-search").value = "";
    showSearch();
    $("picker-dialog").showModal();
    $("picker-search").focus();
}

function showSearch() {
    $("picker-title").textContent = "Add " + picker.kind + " of " + fullName(getPerson(picker.personId));
    $("picker-new-form").hidden = true;
    $("picker-search-view").hidden = false;
    $("picker-error").hidden = true;
    renderResults();
}

function showNewForm() {
    $("picker-title").textContent = "Add new person as a " + picker.kind + " of " + fullName(getPerson(picker.personId));
    $("picker-search-view").hidden = true;
    $("picker-new-form").reset();
    $("picker-new-form").hidden = false;
    $("picker-new-error").hidden = true;
    $("new-given-names").focus();
}

// "José" -> "jose", so searching ignores accents and capitals
function normalize(text) {
    return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// The person themselves and everyone already directly related to them
function excludedIds(personId) {
    const ids = new Set([personId]);
    for (const r of getRelations()) {
        if (r.personA === personId) ids.add(r.personB);
        if (r.personB === personId) ids.add(r.personA);
    }
    return ids;
}

function renderResults() {
    const excluded = excludedIds(picker.personId);
    const candidates = getPersons().filter((p) => !excluded.has(p.id));
    const words = normalize($("picker-search").value).split(/\s+/).filter(Boolean);

    let shown;
    let hint = "";
    if (words.length === 0) {
        shown = candidates.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_COUNT);
    } else {
        // Every typed word must appear somewhere in the name: "jan ke" finds "Jan Keim"
        const matches = candidates
            .filter((p) => words.every((w) => normalize(fullName(p)).includes(w)))
            .sort(compareByName);
        shown = matches.slice(0, MAX_RESULTS);
        if (matches.length === 0) hint = "No results found.";
        else if (matches.length > MAX_RESULTS) hint = "Showing " + MAX_RESULTS + " of " + matches.length + ". Type more to narrow it down.";
    }

    const list = $("picker-list");
    list.replaceChildren(newPersonItem(), ...shown.map(resultItem));
    list.scrollTop = 0;
    $("picker-hint").textContent = hint;
    $("picker-hint").hidden = !hint;
}

function newPersonItem() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "picker-new";
    button.textContent = "+ New person";
    button.onclick = showNewForm;

    const li = document.createElement("li");
    li.append(button);
    return li;
}

function resultItem(p) {
    const name = document.createElement("div");
    name.textContent = fullName(p);
    const meta = document.createElement("div");
    meta.className = "muted";
    meta.textContent = lifespan(p);

    const button = document.createElement("button");
    button.type = "button";
    button.append(name, meta);
    button.onclick = () => savePicker(() => addRelation(makeRelation(picker.personId, picker.kind, p.id)), $("picker-error"));

    const li = document.createElement("li");
    li.append(button);
    return li;
}

async function submitNewPerson(event) {
    event.preventDefault();
    const givenNames = $("new-given-names").value.trim();
    const surname = $("new-surname").value.trim();
    const gender = $("new-gender").value;

    const errorEl = $("picker-new-error");
    if (givenNames === "" && surname === "") return showError(errorEl, "Please fill in a given name or a surname.");
    if (!["male", "female", "other"].includes(gender)) return showError(errorEl, "Please choose a gender.");

    const person = { gender };
    if (givenNames) person.givenNames = givenNames;
    if (surname) person.surname = surname;
    await savePicker(() => addPersonWithRelation(person, picker.personId, picker.kind), errorEl);
}

async function savePicker(action, errorEl) {
    if (busy) return; // ignore double clicks while saving
    busy = true;
    errorEl.hidden = true;
    $("picker-new-submit").disabled = true;
    try {
        await action();
        $("picker-dialog").close();
        picker.onDone();
    } catch (error) {
        console.error("Could not add relative:", error);
        showError(errorEl, friendlyError(error));
    } finally {
        busy = false;
        $("picker-new-submit").disabled = false;
    }
}

// ---------- Removing ----------

// "Remove Piet Keim as parent of Jan Keim?"
export async function confirmRemove(relationId, otherId, kind, personId, onDone) {
    const question = "Remove " + fullName(getPerson(otherId)) + " as " + kind + " of " + fullName(getPerson(personId))
        + "? Both people are kept.";
    if (!confirm(question)) return;

    try {
        await removeRelation(relationId);
        onDone();
    } catch (error) {
        console.error("Could not remove relation:", error);
        alert(friendlyError(error));
    }
}

// ---------- Wedding date ----------

export function openWedding(relationId, onDone) {
    wedding = { relationId, onDone };
    const r = getRelations().find((x) => x.id === relationId);
    $("wedding-title").textContent = fullName(getPerson(r.personA)) + " & " + fullName(getPerson(r.personB));
    fillDate("wedding", r.weddingDate);
    $("wedding-error").hidden = true;
    $("wedding-submit").disabled = false;
    $("wedding-dialog").showModal();
}

async function submitWedding(event) {
    event.preventDefault();
    const date = readDate("wedding", "Wedding date");
    if (date.error) return showError($("wedding-error"), date.error);

    $("wedding-submit").disabled = true;
    try {
        await setWeddingDate(wedding.relationId, date.value);
        $("wedding-dialog").close();
        wedding.onDone();
    } catch (error) {
        console.error("Could not save wedding date:", error);
        showError($("wedding-error"), friendlyError(error));
        $("wedding-submit").disabled = false;
    }
}
