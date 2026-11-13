// Files: the Files tab, plus two pieces the person details page reuses:
//   fileSections()   collapsible sections per category with file cards
//   fileActions()    the buttons for a file's bar: download, edit, and the ⋯ menu
// The file itself is drawn by fileViewer.js.

import { goTo, goBack } from "./router.js";
import { $, friendlyError } from "./ui.js";
import { formatDate } from "./dates.js";
import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { getFile, getFiles, getCategories, getPerson, deleteFile, setProfilePhoto } from "./store.js";
import { fullName, normalizeName } from "./names.js";
import { KIND_NAMES, KIND_ICONS, youTubeId, formatSize, extensionOf } from "./files.js";
import { blobUrl, downloadFile, deletePaths, makeAvatar } from "./storage.js";
import { iconButton } from "./icons.js";
import { menuButton } from "./menu.js";
import { renderFileView } from "./fileViewer.js";

const KIND_FILTERS = [["all", "All"], ["photo", "Photos"], ["video", "Videos"], ["audio", "Audio"], ["document", "Documents"], ["website", "Websites"]];
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
        ? (isAdmin ? "Nothing in the archive yet. Use the + button to add the first file." : "Nothing in the archive yet.")
        : "Nothing matches these filters.";
    status.hidden = shown.length > 0;

    $("files-sections").replaceChildren(...fileSections(shown, (f) => "#/file/" + encodeURIComponent(f.id)));
}

// ---------- Shared: sections per category ----------

// One collapsible section per category (alphabetical), "Uncategorized" last, empty ones left out.
// Without any categories at all there's just one grid, without a header.
// linkFor(file) gives the address a card links to.
export function fileSections(files, linkFor) {
    const groups = groupFiles(files);
    if (groups.length === 1 && groups[0].key === null) return [grid(groups[0].files, linkFor)];
    const collapsed = readCollapsed();

    return groups.map(({ key, name, files: inGroup }) => {
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
        return section;
    });
}

// The files in the order fileSections shows them: per category, newest first within each. For next / previous.
export function fileOrder(files) {
    return groupFiles(files).flatMap((g) => g.files);
}

// [{ key, name, files }] per category (alphabetical), "Uncategorized" last, empty ones left out.
// Without any categories: one group with key null.
function groupFiles(files) {
    const sorted = [...files].sort(newestFirst);
    const categories = getCategories();
    if (categories.length === 0) return [{ key: null, name: null, files: sorted }];

    const known = new Set(categories.map((c) => c.id));
    return [...categories.map((c) => ({ key: c.id, name: c.name })), { key: "", name: "Uncategorized" }]
        .map((g) => ({ ...g, files: sorted.filter((f) => (known.has(f.category) ? f.category : "") === g.key) }))
        .filter((g) => g.files.length > 0);
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
    thumb.textContent = KIND_ICONS[f.kind];
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
    // Next / previous go through the list as it's shown with the current filters, or through all
    // files when this one isn't in it (e.g. opened from a link while filters are set)
    const filtered = fileOrder(getFiles().filter(matches));
    renderFileView($("file-page"), f, {
        list: filtered.some((x) => x.id === id) ? filtered : fileOrder(getFiles()),
        hrefFor: (x) => "#/file/" + encodeURIComponent(x.id),
    });
}

// ---------- Shared: the buttons for one file ----------

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

    if (isAdmin) actions.push(iconButton("pencil", "Edit", () => { location.hash = "#/file/edit/" + encodeURIComponent(f.id); }));

    // Viewers only get "File info" here
    const more = [];
    const profile = isAdmin && options.profileFor && profilePhotoItem(f, options.profileFor, options.onChange);
    if (profile) more.push(profile);
    more.push({ label: "File info", onclick: () => showFileInfo(f) });
    if (isAdmin) more.push({ label: "Delete file", danger: true, onclick: () => remove(f, options.onDeleted) });
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

// ---------- File info ----------

// Everything about the file that the viewer itself doesn't show. Who uploaded it: admins only.
async function showFileInfo(f) {
    const category = getCategories().find((c) => c.id === f.category);
    const rows = [
        ["Title", f.title],
        ["Type", KIND_NAMES[f.kind]],
    ];
    if (f.date) rows.push(["Date", formatDate(f.date)]);
    if (category) rows.push(["Category", category.name]);
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
    rows.push([f.source === "upload" ? "Uploaded on" : "Added on", f.createdAt ? new Date(f.createdAt).toLocaleString() : "Unknown"]);
    if (isAdmin) rows.push([f.source === "upload" ? "Uploaded by" : "Added by", f.uploadedBy ? "Loading…" : "Unknown"]);

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
    if (!isAdmin || !f.uploadedBy) return;
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
