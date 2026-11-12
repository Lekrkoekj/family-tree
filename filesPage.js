// Files: the Files tab, plus three pieces the person details page reuses:
//   fileSections()   collapsible sections per category with file cards
//   renderFileView() the file itself and its details, drawn into any container
//   fileActions()    the buttons for a file's bar: download, edit, and the ⋯ menu

import { goTo, goBack } from "./router.js";
import { $, friendlyError } from "./ui.js";
import { formatDate } from "./dates.js";
import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { getFile, getFiles, getCategories, getPerson, deleteFile, setProfilePhoto } from "./store.js";
import { fullName, normalizeName } from "./names.js";
import { KIND_NAMES, youTubeId, formatSize, extensionOf } from "./files.js";
import { blobUrl, downloadFile, deletePaths, makeAvatar } from "./storage.js";
import { iconButton } from "./icons.js";
import { menuButton } from "./menu.js";

const KIND_FILTERS = [["all", "All"], ["photo", "Photos"], ["video", "Videos"], ["audio", "Audio"], ["document", "Documents"], ["website", "Websites"]];
const ICONS = { photo: "🖼️", video: "🎬", audio: "🎵", pdf: "📄", website: "🌐", other: "📎" };
const COLLAPSED_KEY = "family-tree-collapsed-categories";

let isAdmin = false;
const filters = { kind: "all", text: "" }; // kept while the site is open

// PDFs and "other" files are both documents in the filter
const filterGroup = (f) => (f.kind === "pdf" || f.kind === "other" ? "document" : f.kind);
const newestFirst = (a, b) => b.updatedAt - a.updatedAt;

export function initFiles(options) {
    isAdmin = options.isAdmin;
    $("files-search").oninput = () => {
        filters.text = $("files-search").value;
        renderList();
    };
}

// ---------- The Files tab ----------

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
    $("files-search").value = filters.text;
    renderList();
}

function matches(f) {
    if (filters.kind !== "all" && filterGroup(f) !== filters.kind) return false;

    // Every typed word must appear in the title, description or a linked person's name
    const words = normalizeName(filters.text).split(/\s+/).filter(Boolean);
    const names = f.people.map(getPerson).filter(Boolean).map(fullName);
    const text = normalizeName([f.title, f.description ?? "", ...names].join(" "));
    return words.every((w) => text.includes(w));
}

function renderList() {
    const all = getFiles();
    const shown = all.filter(matches).sort(newestFirst);

    const status = $("files-status");
    status.textContent = all.length === 0
        ? (isAdmin ? "No files yet. Use the + button to add the first one." : "No files yet.")
        : "No files match these filters.";
    status.hidden = shown.length > 0;

    $("files-sections").replaceChildren(...fileSections(shown, (f) => "#/file/" + encodeURIComponent(f.id)));
}

// ---------- Shared: sections per category ----------

// One collapsible section per category (alphabetical), "Uncategorized" last, empty ones left out.
// Without any categories at all there's just one grid, without a header.
// linkFor(file) gives the address a card links to.
export function fileSections(files, linkFor) {
    const sorted = [...files].sort(newestFirst);
    const categories = getCategories();
    if (categories.length === 0) return [grid(sorted, linkFor)];

    const known = new Set(categories.map((c) => c.id));
    const groups = [...categories.map((c) => ({ key: c.id, name: c.name })), { key: "", name: "Uncategorized" }];
    const collapsed = readCollapsed();

    return groups.flatMap(({ key, name }) => {
        const inGroup = sorted.filter((f) => (known.has(f.category) ? f.category : "") === key);
        if (inGroup.length === 0) return [];

        // <details> / <summary> is the browser's own open/close section
        const section = document.createElement("details");
        section.className = "file-section";
        section.open = !collapsed.has(key);
        section.ontoggle = () => {
            const set = readCollapsed();
            if (section.open) set.delete(key);
            else set.add(key);
            writeCollapsed(set);
        };
        const summary = document.createElement("summary");
        summary.textContent = name + " (" + inGroup.length + ")";
        section.append(summary, grid(inGroup, linkFor));
        return [section];
    });
}

// Which sections someone closed, remembered in this browser
function readCollapsed() {
    try {
        return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY)) ?? []);
    } catch {
        return new Set();
    }
}

function writeCollapsed(set) {
    try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
    } catch { }
}

function grid(files, linkFor) {
    const ul = document.createElement("ul");
    ul.className = "file-grid";
    ul.append(...files.map((f) => card(f, linkFor(f))));
    return ul;
}

function card(f, href) {
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
    meta.textContent = [KIND_NAMES[f.kind], f.date ? formatDate(f.date) : ""].filter(Boolean).join(" • ");

    const link = document.createElement("a");
    link.href = href;
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
    const src = f && await thumbSource(f).catch(() => null);
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

// ---------- The file page (Files tab) ----------

// The app's own top bar is the file bar here: the file name in the middle, the buttons on the right
export function renderFilePage(id) {
    const f = getFile(id);
    if (!f) {
        goTo("#/files", { replace: true });
        return;
    }
    $("title").textContent = f.title;
    $("top-actions").replaceChildren(...fileActions(f));
    renderFileView($("file-page"), f);
}

// ---------- Shared: one file ----------

// Draws the file itself and its details into `container` (the bar with buttons is separate: fileActions)
export function renderFileView(container, f) {
    // Downloads finish later; this token tells whether this container still shows this file by then
    const token = {};
    container.fileViewToken = token;
    const alive = () => container.fileViewToken === token && container.isConnected;

    const parts = [];
    const viewerEl = document.createElement("div");
    viewerEl.className = "file-viewer";
    viewerEl.append(...viewer(f, viewerEl, alive));
    parts.push(viewerEl);

    if (f.description) {
        const description = document.createElement("p");
        description.className = "file-description";
        description.textContent = f.description;
        parts.push(description);
    }

    const factList = document.createElement("dl");
    factList.className = "facts";
    factList.append(...facts(f));
    parts.push(factList, people(f));
    container.replaceChildren(...parts);
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
function viewer(f, viewerEl, alive) {
    const url = f.url;
    const original = f.storage?.original.path;

    // Runs `use(src)` when the download is ready, unless something else is shown by then
    const load = (promise, use) => promise.then((src) => { if (alive()) use(src); }).catch((error) => {
        console.error("Could not load file:", error);
        if (alive()) viewerEl.replaceChildren(note(friendlyError(error)));
    });

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

    if (f.kind === "website") {
        // Websites can't be shown inside the site (most block that), so a clear button to open it
        const visit = document.createElement("a");
        visit.className = "button";
        visit.href = url;
        visit.target = "_blank";
        visit.rel = "noopener noreferrer";
        visit.textContent = "Visit website ↗";
        return [note("This is a link to " + new URL(url).hostname + "."), visit];
    }
    return [note(ICONS.other + " No preview for this kind of file. Use the download button below.")];
}

function note(text) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = text;
    return p;
}

function people(f) {
    const list = f.people.map(getPerson).filter(Boolean);
    const box = document.createElement("div");
    box.className = "chips-links";
    box.hidden = list.length === 0;
    const label = document.createElement("span");
    label.className = "muted";
    label.textContent = "People: ";
    box.append(label, ...list.map((p) => {
        const a = document.createElement("a");
        a.href = "#/person/" + encodeURIComponent(p.id);
        a.textContent = fullName(p);
        return a;
    }));
    return box;
}

// The buttons for a file's bar. options:
//   profileFor:  a person id; admins then get "Use as / Remove as profile photo" for that person in the ⋯ menu
//   onChange():  called after the profile photo changed, so the page around it can update
//   onDeleted(): where to go after deleting (default: back)
export function fileActions(f, options = {}) {
    const actions = [];

    if (f.source === "upload") {
        const { original, display } = f.storage;
        const getOriginal = () => downloadFile(original.path, original.name);
        if (display) {
            const smallName = original.name.replace(/\.[^.]+$/, "") + "." + display.path.split(".").pop();
            actions.push(menuButton("download", "Download", [
                { label: "Original (" + formatSize(original.size) + ")", onclick: getOriginal },
                { label: "Smaller version (" + formatSize(display.size) + ")", onclick: () => downloadFile(display.path, smallName) },
            ]));
        } else {
            actions.push(iconButton("download", "Download", () => getOriginal().catch((e) => alert(friendlyError(e)))));
        }
    } else {
        actions.push(iconButton("external", f.kind === "website" ? "Visit website" : "Open link",
            () => window.open(f.url, "_blank", "noopener,noreferrer")));
    }

    if (!isAdmin) return actions;

    actions.push(iconButton("pencil", "Edit", () => { location.hash = "#/file/edit/" + encodeURIComponent(f.id); }));

    const more = [];
    const profile = options.profileFor && profilePhotoItem(f, options.profileFor, options.onChange);
    if (profile) more.push(profile);
    more.push({ label: "File info", onclick: () => showFileInfo(f) });
    more.push({ label: "Delete file", danger: true, onclick: () => remove(f, options.onDeleted) });
    actions.push(menuButton("more", "More", more));
    return actions;
}

// For uploaded photos, on a person's page: "Use as profile photo" or "Remove as profile photo"
function profilePhotoItem(f, personId, onChange) {
    const source = f.source === "upload" && f.kind === "photo" && (f.storage.thumb ?? f.storage.display);
    if (!source) return null; // a linked photo can't be used: browsers don't let a site read pixels from another site's image

    const isCurrent = getPerson(personId)?.photo?.file === f.id;
    return {
        label: isCurrent ? "Remove as profile photo" : "Use as profile photo",
        onclick: async () => {
            const photo = isCurrent ? null : { file: f.id, avatar: await makeAvatar(await blobUrl(source.path)) };
            await setProfilePhoto(personId, photo);
            onChange?.();
        },
    };
}

// ---------- File info (admins) ----------

async function showFileInfo(f) {
    const rows = [
        ["Title", f.title],
        ["Type", KIND_NAMES[f.kind]],
    ];
    if (f.source === "upload") {
        const { original, display } = f.storage;
        rows.push(
            ["File type", original.type || extensionOf(original.name).toUpperCase() || "Unknown"],
            ["Original file", original.name],
            ["Original size", formatSize(original.size)],
        );
        if (display) rows.push(["Smaller version", formatSize(display.size)]);
    } else {
        rows.push(["Link", f.url]);
    }
    rows.push(
        [f.source === "upload" ? "Uploaded on" : "Added on", f.createdAt ? new Date(f.createdAt).toLocaleString() : "Unknown"],
        [f.source === "upload" ? "Uploaded by" : "Added by", f.uploadedBy ? "Loading…" : "Unknown"],
    );

    const list = $("file-info-list");
    list.replaceChildren(...rows.flatMap(([label, value]) => {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        return [dt, dd];
    }));
    $("file-info-dialog").showModal();

    // uploadedBy is the uploader's email (the id of their user document); look up their current name
    if (!f.uploadedBy) return;
    const by = list.lastElementChild;
    try {
        const user = (await getDoc(doc(db, "users", f.uploadedBy))).data();
        const name = user && [user.firstName, user.lastName].filter(Boolean).join(" ");
        by.textContent = name ? name + " (" + f.uploadedBy + ")" : f.uploadedBy;
    } catch {
        by.textContent = f.uploadedBy;
    }
}

async function remove(f, onDeleted) {
    if (!confirm("Delete “" + f.title + "”? This can't be undone.")) return;
    // The document first: if removing the stored files then fails, at worst an invisible file is left behind
    await deleteFile(f.id);
    if (f.source === "upload") await deletePaths(Object.values(f.storage).map((s) => s.path));
    (onDeleted ?? goBack)();
}
