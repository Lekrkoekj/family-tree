// The "pick a person" popup, used for relatives and for the people in a file.
// It only lets you choose; what happens with the choice is up to whoever opens it (onPick).

import { $, showError, friendlyError } from "./ui.js";
import { lifespan } from "./dates.js";
import { getPersons } from "./store.js";
import { fullName, searchPeople } from "./names.js";

const RECENT_COUNT = 10; // shown before anything is typed
const MAX_RESULTS = 20;

let options = null; // what openPicker was called with, while the popup is open
let busy = false;
let initialized = false;

// options:
//   title           "Add parent of Jan Keim"
//   newPersonTitle  "Add new person as a parent of Jan Keim"
//   exclude         Set of ids that may not be picked
//   onPick(choice)  async; choice is { id } for an existing person or { newPerson: data } for "+ New person".
//                   The popup stays open (and shows the error) until it succeeds.
export function openPicker(pickerOptions) {
    if (!initialized) init();
    options = pickerOptions;
    $("picker-search").value = "";
    showSearch();
    $("picker-dialog").showModal();
    $("picker-search").focus();
}

function init() {
    initialized = true;
    $("picker-search").oninput = renderResults;
    $("picker-new-back").onclick = showSearch;
    $("picker-new-form").onsubmit = submitNewPerson;
    $("picker-cancel").onclick = () => $("picker-dialog").close();
}

function showSearch() {
    $("picker-title").textContent = options.title;
    $("picker-new-form").hidden = true;
    $("picker-search-view").hidden = false;
    $("picker-error").hidden = true;
    renderResults();
}

function showNewForm() {
    $("picker-title").textContent = options.newPersonTitle;
    $("picker-search-view").hidden = true;
    $("picker-new-form").reset();
    $("picker-new-form").hidden = false;
    $("picker-new-error").hidden = true;
    $("new-given-names").focus();
}

function renderResults() {
    const candidates = getPersons().filter((p) => !options.exclude.has(p.id));
    const text = $("picker-search").value;

    let shown;
    let hint = "";
    if (!text.trim()) {
        shown = candidates.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_COUNT);
    } else {
        const matches = searchPeople(candidates, text);
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
    button.onclick = () => pick({ id: p.id }, $("picker-error"));

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
    await pick({ newPerson: person }, errorEl);
}

async function pick(choice, errorEl) {
    if (busy) return; // ignore double clicks while saving
    busy = true;
    errorEl.hidden = true;
    $("picker-new-submit").disabled = true;
    try {
        await options.onPick(choice);
        $("picker-dialog").close();
    } catch (error) {
        console.error("Could not use the chosen person:", error);
        showError(errorEl, friendlyError(error));
    } finally {
        busy = false;
        $("picker-new-submit").disabled = false;
    }
}
