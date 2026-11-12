// The "Add file" / "Edit file" screen (admins): upload a file or add a link, with title, date, category and people.

import { goBack, goTo } from "./router.js";
import { $, showError, friendlyError } from "./ui.js";
import { readDate, fillDate } from "./dates.js";
import { getFile, getPerson, getCategories, newFileId, saveFile, savePerson } from "./store.js";
import { fullName } from "./names.js";
import { KIND_NAMES, extensionOf, kindFromFile, kindFromUrl, formatSize } from "./files.js";
import { uploadBlob, deletePaths, photoVersions, MAX_FILE_SIZE } from "./storage.js";
import { openPicker } from "./picker.js";

let people = [];       // ids of the people linked to this file, in the order they were added
let previewUrl = null; // temporary link for the photo preview, freed again when no longer needed
let editing = null;    // the file being edited, or null when adding a new one

// Used by both #/file/new (id = null) and #/file/edit/<id>
export function renderFileForm(id) {
    editing = id ? getFile(id) : null;
    if (id && !editing) {
        goTo("#/files", { replace: true });
        return;
    }

    $("file-form").reset();
    setPreview(null);
    $("file-info").hidden = $("file-url-info").hidden = $("file-error").hidden = true;
    $("file-progress").hidden = true;
    $("file-submit").disabled = false;
    $("file-submit").textContent = editing ? "Save changes" : "Save";

    const select = $("file-category");
    select.replaceChildren(new Option("Uncategorized", ""), ...getCategories().map((c) => new Option(c.name, c.id)));

    // When editing, the file itself stays the same (delete and add again to replace it); a link can be changed
    document.querySelector("#file-form .segmented").hidden = !!editing;
    $("file-input").hidden = !!editing;
    showSource(editing?.source ?? "upload");

    people = editing ? editing.people.filter((p) => getPerson(p)) : [];
    renderPeople();
    if (!editing) return;

    $("file-title").value = editing.title;
    $("file-description").value = editing.description ?? "";
    fillDate("file-date", editing.date);
    select.value = editing.category ?? "";
    if (editing.source === "link") {
        $("file-url").value = editing.url;
        onUrlTyped();
    } else {
        $("file-info").textContent = editing.storage.original.name + " · " + formatSize(editing.storage.original.size) + " · " + KIND_NAMES[editing.kind];
        $("file-info").hidden = false;
    }
}

export function initFileForm() {
    document.querySelectorAll('input[name="file-source"]').forEach((radio) => {
        radio.onchange = () => showSource(radio.value);
    });
    $("file-input").onchange = onFileChosen;
    $("file-url").oninput = onUrlTyped;
    $("file-add-person").onclick = addPerson;
    $("file-form").onsubmit = submit;
}

function showSource(source) {
    $("file-upload-part").hidden = source !== "upload";
    $("file-link-part").hidden = source !== "link";
}

// ---------- Choosing a file or typing a link ----------

function onFileChosen() {
    const file = $("file-input").files[0];
    setPreview(null);
    if (!file) {
        $("file-info").hidden = true;
        return;
    }
    $("file-info").textContent = file.name + " · " + formatSize(file.size) + " · " + KIND_NAMES[kindFromFile(file)];
    $("file-info").hidden = false;

    // Suggest a title from the file name, unless one was typed already
    if (!$("file-title").value.trim()) $("file-title").value = file.name.replace(/\.[^.]+$/, "");
    if (kindFromFile(file) === "photo") setPreview(file);
}

function setPreview(file) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = file ? URL.createObjectURL(file) : null;
    const img = $("file-preview");
    img.hidden = !previewUrl;
    img.onerror = () => { img.hidden = true; }; // a photo the browser can't show (e.g. HEIC)
    if (previewUrl) img.src = previewUrl;
    else img.removeAttribute("src");
}

function onUrlTyped() {
    const url = $("file-url").value.trim();
    const kind = kindFromUrl(url);
    $("file-url-info").textContent = kind ? "Detected: " + KIND_NAMES[kind] : "Not a valid link yet";
    $("file-url-info").hidden = !url;
}

// ---------- People ----------

// The same popup as for adding relatives. "+ New person" creates them right away and adds them here.
function addPerson() {
    openPicker({
        title: "Add person to this file",
        newPersonTitle: "Add new person to this file",
        exclude: new Set(people),
        onPick: async (choice) => {
            people.push(choice.id ?? await savePerson(null, choice.newPerson));
            renderPeople();
        },
    });
}

function renderPeople() {
    $("file-people").replaceChildren(...people.map((id) => {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "Remove");
        remove.onclick = () => {
            people = people.filter((x) => x !== id);
            renderPeople();
        };
        const li = document.createElement("li");
        li.append(fullName(getPerson(id)), remove);
        return li;
    }));
}

// ---------- Saving ----------

async function submit(event) {
    event.preventDefault();
    const errorEl = $("file-error");
    errorEl.hidden = true;
    const source = editing?.source ?? document.querySelector('input[name="file-source"]:checked').value;

    // Editing keeps everything that isn't on the form (kind, storage...); the form fields are filled in again below
    const data = editing ? { ...editing } : { source };
    for (const key of ["id", "updatedAt", "description", "category", "date"]) delete data[key];
    data.people = [...people];
    const description = $("file-description").value.trim();
    if (description) data.description = description;
    const category = $("file-category").value;
    if (category) data.category = category;
    const date = readDate("file-date", "Date");
    if (date.error) return showError(errorEl, date.error);
    if (date.value) data.date = date.value;

    const file = $("file-input").files[0];
    const url = $("file-url").value.trim();
    if (editing && source === "upload") {
        // nothing to check: the stored file stays as it is
    } else if (source === "upload") {
        if (!file) return showError(errorEl, "Please choose a file.");
        if (file.size >= MAX_FILE_SIZE) return showError(errorEl, "That file is " + formatSize(file.size) + "; the limit is 100 MB.");
        data.kind = kindFromFile(file);
    } else {
        data.kind = kindFromUrl(url);
        if (!data.kind) return showError(errorEl, "Please enter a link that starts with http:// or https://.");
        data.url = url;
    }
    data.title = $("file-title").value.trim()
        || (source === "upload" ? (file?.name ?? editing.storage.original.name) : new URL(url).hostname);

    $("file-submit").disabled = true;
    const id = editing?.id ?? newFileId();
    let uploaded = [];
    try {
        if (source === "upload" && !editing) {
            const result = await uploadAll(id, file, data.kind);
            uploaded = result.paths;
            data.storage = result.storage;
        }
        await saveFile(id, data);
        goBack();
    } catch (error) {
        console.error("Could not save file:", error);
        await deletePaths(uploaded); // don't leave half an upload behind in Storage
        showError(errorEl, friendlyError(error));
        $("file-submit").disabled = false;
        $("file-progress").hidden = true;
    }
}

// Uploads the original, and for photos also the display version and thumbnail.
// Returns { storage: what goes in the Firestore document, paths: everything that was uploaded }.
async function uploadAll(id, file, kind) {
    const ext = extensionOf(file.name);
    const parts = [{ key: "original", blob: file, path: "files/" + id + "/original" + (ext ? "." + ext : "") }];

    if (kind === "photo") {
        const versions = await photoVersions(file);
        for (const key of ["display", "thumb"]) {
            const blob = versions?.[key];
            if (blob) parts.push({ key, blob, path: "files/" + id + "/" + key + "." + (blob.type === "image/webp" ? "webp" : "png") });
        }
    }

    // One progress bar for all parts together
    const total = parts.reduce((sum, p) => sum + p.blob.size, 0);
    let done = 0;
    const progress = $("file-progress");
    progress.hidden = false;
    progress.value = 0;

    const storage = {};
    const paths = [];
    for (const part of parts) {
        paths.push(part.path);
        await uploadBlob(part.path, part.blob, (sent) => { progress.value = (done + sent) / total; });
        done += part.blob.size;
        storage[part.key] = { path: part.path, size: part.blob.size, type: part.blob.type || "" };
    }
    storage.original.name = file.name;
    return { storage, paths };
}
