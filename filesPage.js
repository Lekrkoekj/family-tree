// The Files tab (everyone): a searchable, filterable grid, and the page of a single file.

import { goTo, goBack } from "./router.js";
import { $, friendlyError } from "./ui.js";
import { formatDate } from "./dates.js";
import { getFile, getFiles, getCategories, getPerson, deleteFile, setProfilePhoto } from "./store.js";
import { fullName, normalizeName } from "./names.js";
import { KIND_NAMES, youTubeId, formatSize } from "./files.js";
import { blobUrl, downloadFile, deletePaths, makeAvatar } from "./storage.js";

const KIND_FILTERS = [["all", "All"], ["photo", "Photos"], ["video", "Videos"], ["audio", "Audio"], ["document", "Documents"], ["website", "Websites"]];
const ICONS = { photo: "🖼️", video: "🎬", audio: "🎵", pdf: "📄", website: "🌐", other: "📎" };

let isAdmin = false;
const filters = { kind: "all", category: "all", text: "" }; // kept while the site is open
let showingId = null;

// PDFs and "other" files are both documents in the filter
const filterGroup = (f) => (f.kind === "pdf" || f.kind === "other" ? "document" : f.kind);

export function initFiles(options) {
    isAdmin = options.isAdmin;
    $("files-search").oninput = () => {
        filters.text = $("files-search").value;
        renderGrid();
    };
    $("files-category").onchange = () => {
        filters.category = $("files-category").value;
        renderGrid();
    };
}

// ---------- The list ----------

export function renderFiles() {
    $("files-kinds").replaceChildren(...KIND_FILTERS.map(([key, label]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.classList.toggle("active", filters.kind === key);
        button.onclick = () => {
            filters.kind = key;
            renderFiles();
        };
        return button;
    }));

    const select = $("files-category");
    select.replaceChildren(new Option("All categories", "all"), new Option("Uncategorized", ""),
        ...getCategories().map((c) => new Option(c.name, c.id)));
    select.value = filters.category;
    if (select.value !== filters.category) filters.category = select.value = "all"; // that category was deleted
    select.hidden = getCategories().length === 0;

    $("files-search").value = filters.text;
    renderGrid();
}

function matches(f) {
    if (filters.kind !== "all" && filterGroup(f) !== filters.kind) return false;
    if (filters.category !== "all" && (f.category ?? "") !== filters.category) return false;

    // Every typed word must appear in the title, description or a linked person's name
    const words = normalizeName(filters.text).split(/\s+/).filter(Boolean);
    const names = f.people.map(getPerson).filter(Boolean).map(fullName);
    const text = normalizeName([f.title, f.description ?? "", ...names].join(" "));
    return words.every((w) => text.includes(w));
}

function renderGrid() {
    const all = getFiles();
    const shown = all.filter(matches).sort((a, b) => b.updatedAt - a.updatedAt); // newest first

    const status = $("files-status");
    status.textContent = all.length === 0
        ? (isAdmin ? "No files yet. Use the + button to add the first one." : "No files yet.")
        : "No files match these filters.";
    status.hidden = shown.length > 0;

    $("files-grid").replaceChildren(...shown.map(card));
}

function card(f) {
    const thumb = document.createElement("div");
    thumb.className = "file-thumb";
    thumb.textContent = ICONS[f.kind];
    thumb.dataset.id = f.id;
    thumbObserver.observe(thumb);

    const title = document.createElement("div");
    title.className = "file-card-title";
    title.textContent = f.title;
    const meta = document.createElement("div");
    meta.className = "muted";
    meta.textContent = [KIND_NAMES[f.kind], f.date ? formatDate(f.date) : ""].filter(Boolean).join(" · ");

    const link = document.createElement("a");
    link.href = "#/file/" + encodeURIComponent(f.id);
    link.append(thumb, title, meta);
    const li = document.createElement("li");
    li.append(link);
    return li;
}

// Thumbnails are only downloaded once their card is (almost) on screen
const thumbObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        thumbObserver.unobserve(entry.target);
        showThumb(entry.target);
    }
}, { rootMargin: "200px" });

async function showThumb(el) {
    const f = getFile(el.dataset.id);
    const src = await thumbSource(f).catch(() => null);
    if (!src) return; // keep the icon
    const img = document.createElement("img");
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onload = () => el.replaceChildren(img);
    img.src = src;
}

function thumbSource(f) {
    if (f.source === "upload") return f.storage.thumb ? blobUrl(f.storage.thumb.path) : Promise.resolve(null);
    if (f.kind === "photo") return Promise.resolve(f.url);
    const yt = youTubeId(f.url);
    return Promise.resolve(yt ? "https://img.youtube.com/vi/" + yt + "/mqdefault.jpg" : null);
}

// ---------- One file ----------

export function renderFilePage(id) {
    const f = getFile(id);
    if (!f) {
        goTo("#/files", { replace: true });
        return;
    }
    showingId = id;

    $("file-page-title").textContent = f.title;
    $("file-page-description").textContent = f.description ?? "";
    $("file-page-description").hidden = !f.description;
    $("file-page-facts").replaceChildren(...facts(f));
    $("file-viewer").replaceChildren(...viewer(f));
    renderPeople(f);
    renderActions(f);
}

function facts(f) {
    const category = getCategories().find((c) => c.id === f.category);
    const rows = [
        ["Type", KIND_NAMES[f.kind]],
        ["Date", f.date ? formatDate(f.date) : ""],
        ["Category", category?.name ?? ""],
        ["File", f.source === "upload" ? f.storage.original.name + " · " + formatSize(f.storage.original.size) : ""],
        ["Link", f.source === "link" ? new URL(f.url).hostname : ""],
    ];
    return rows.filter(([, value]) => value).flatMap(([label, value]) => {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        return [dt, dd];
    });
}

// Returns the elements that show the file itself
function viewer(f) {
    const url = f.url;
    const original = f.storage?.original.path;

    if (f.kind === "photo") {
        const img = document.createElement("img");
        img.alt = f.title;
        img.referrerPolicy = "no-referrer";
        img.onerror = () => img.replaceWith(note("No preview available. Download the file to view it."));
        if (f.source === "link") img.src = url;
        else load(blobUrl((f.storage.display ?? f.storage.original).path), (src) => { img.src = src; });
        return [img];
    }

    if (f.kind === "video" && f.source === "link" && youTubeId(url)) {
        // youtube-nocookie: YouTube only sets cookies once someone presses play
        const frame = document.createElement("iframe");
        frame.src = "https://www.youtube-nocookie.com/embed/" + youTubeId(url);
        frame.allow = "fullscreen; picture-in-picture";
        frame.referrerPolicy = "strict-origin-when-cross-origin";
        frame.className = "video-frame";
        return [frame];
    }

    if (f.kind === "video" || f.kind === "audio") {
        const media = document.createElement(f.kind);
        media.controls = true;
        if (f.source === "link") media.src = url;
        else load(blobUrl(original), (src) => { media.src = src; });
        return [media];
    }

    if (f.kind === "pdf") {
        // The browser's own PDF viewer. Not every phone shows PDFs inside a page; the "Open" link always works.
        const frame = document.createElement("iframe");
        frame.className = "pdf-frame";
        frame.title = f.title;
        const open = document.createElement("a");
        open.textContent = "Open PDF in a new tab ↗";
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        if (f.source === "link") frame.src = open.href = url;
        else load(blobUrl(original), (src) => { frame.src = open.href = src; });
        return [frame, open];
    }

    if (f.kind === "website") return [note("This is a link to " + new URL(url).hostname + ". Use “Visit website” below to open it.")];
    return [note(ICONS.other + " No preview for this kind of file. Use the download button below.")];
}

// Runs `use(src)` when the download is ready, unless the user has opened another file meanwhile
function load(promise, use) {
    const id = showingId;
    promise.then((src) => { if (showingId === id) use(src); }).catch((error) => {
        console.error("Could not load file:", error);
        if (showingId === id) $("file-viewer").replaceChildren(note(friendlyError(error)));
    });
}

function note(text) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = text;
    return p;
}

function renderPeople(f) {
    const people = f.people.map(getPerson).filter(Boolean);
    const box = $("file-page-people");
    box.hidden = people.length === 0;
    const label = document.createElement("span");
    label.className = "muted";
    label.textContent = "People: ";
    box.replaceChildren(label, ...people.map((p) => {
        const a = document.createElement("a");
        a.href = "#/person/" + encodeURIComponent(p.id);
        a.textContent = fullName(p);
        return a;
    }));
}

function renderActions(f) {
    const actions = [];

    if (f.source === "upload") {
        const { original, display } = f.storage;
        actions.push(actionButton("Download original (" + formatSize(original.size) + ")", () => downloadFile(original.path, original.name)));
        if (display) {
            const smallName = original.name.replace(/\.[^.]+$/, "") + "." + display.path.split(".").pop();
            actions.push(actionButton("Download smaller version (" + formatSize(display.size) + ")", () => downloadFile(display.path, smallName)));
        }
    } else {
        const visit = document.createElement("a");
        visit.className = "button";
        visit.href = f.url;
        visit.target = "_blank";
        visit.rel = "noopener noreferrer";
        visit.textContent = (f.kind === "website" ? "Visit website" : "Open link") + " ↗";
        actions.push(visit);
    }

    if (isAdmin) {
        const edit = document.createElement("a");
        edit.className = "button";
        edit.href = "#/file/edit/" + encodeURIComponent(f.id);
        edit.textContent = "Edit";
        actions.push(edit, actionButton("Delete", () => remove(f), "danger"));
        actions.push(...profilePhotoButtons(f));
    }
    $("file-page-actions").replaceChildren(...actions);
}

// TEMPORARY HOME: moves to the person details page later.
// For uploaded photos: per linked person, "Use as profile photo" or "Remove as profile photo".
function profilePhotoButtons(f) {
    const source = f.source === "upload" && f.kind === "photo" && (f.storage.thumb ?? f.storage.display);
    if (!source) return []; // a linked photo can't be used: browsers don't let a site read pixels from another site's image

    return f.people.map(getPerson).filter(Boolean).map((p) => {
        const isCurrent = p.photo?.file === f.id;
        const label = (isCurrent ? "Remove as profile photo for " : "Use as profile photo for ") + fullName(p);
        return actionButton(label, async () => {
            const photo = isCurrent ? null : { file: f.id, avatar: await makeAvatar(await blobUrl(source.path)) };
            await setProfilePhoto(p.id, photo);
            renderActions(f); // the button text changes
        });
    });
}

function actionButton(text, onclick, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.className = className;
    button.onclick = async () => {
        button.disabled = true;
        try {
            await onclick();
        } catch (error) {
            console.error(error);
            alert(friendlyError(error));
        } finally {
            button.disabled = false;
        }
    };
    return button;
}

async function remove(f) {
    if (!confirm("Delete “" + f.title + "”? This can't be undone.")) return;
    // The document first: if removing the stored files then fails, at worst an invisible file is left behind
    await deleteFile(f.id);
    if (f.source === "upload") await deletePaths(Object.values(f.storage).map((s) => s.path));
    goBack();
}
