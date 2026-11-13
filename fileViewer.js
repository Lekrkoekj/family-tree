// One file, filling the space it's given (the file page, or the right column of the details page). Three layouts:
//   photo  the photo fitted on a blurred copy of itself; zoom and drag; date, description and people in an
//          overlay that fades away when the mouse stops moving
//   strip  video (also YouTube) and PDF: the file on top, date / description / people in a strip below.
//          They're iframes or have their own controls, so nothing is drawn over them.
//   card   websites, audio and other files: a grey card with an icon, the name and a button
// The bar with the buttons (download, edit, ⋯) is separate: fileActions() in filesPage.js.
// Next / previous: arrows on the sides, the ← and → keys, and swiping on a phone.

import { goTo } from "./router.js";
import { friendlyError } from "./ui.js";
import { formatDate } from "./dates.js";
import { getPerson } from "./store.js";
import { fullName } from "./names.js";
import { KIND_ICONS, youTubeId } from "./files.js";
import { blobUrl, downloadFile } from "./storage.js";
import { icon, iconButton } from "./icons.js";
import { panZoom } from "./panZoom.js";

const IDLE_TIME = 2500;  // ms without moving the mouse before the overlay fades out
const DOUBLE_TAP = 300;  // ms: a second tap within this time is a double tap
const DOUBLE_TAP_ZOOM = 2.5; // times the fitted size
const SWIPE_DISTANCE = 60;   // pixels sideways for a swipe to the next / previous file
const TAG_WORDS = { photo: "photo", video: "video", audio: "audio", pdf: "document", website: "website", other: "file" }; // "People tagged in this …"

const SLIDE = { distance: 40, duration: 200 }; // px and ms: the old file slides out, the new one in

let keyTarget = null;       // the viewer the ← and → keys go to: { container, alive, nav }
let slideDirection = 0;     // -1 / +1 while going to the previous / next file
const containers = new Set(); // every container that shows a file

// browse (optional): { list: files in the order they're shown, hrefFor(file): its address }
export function renderFileView(container, f, browse = null) {
    // Downloads finish later; this token tells whether this container still shows this file by then
    const token = {};
    container.fileViewToken = token;
    const alive = () => container.fileViewToken === token && container.isConnected;
    containers.add(container);

    const preview = document.createElement("div");
    preview.className = "file-preview";
    const old = container.querySelector(":scope > .file-preview:not(.leaving)");
    const dir = slideDirection;
    slideDirection = 0;
    if (old && dir && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        container.append(preview);
        slide(old, preview, dir);
    } else {
        container.replaceChildren(preview);
    }

    const nav = navigation(f, browse);
    keyTarget = { container, alive, nav };

    if (f.kind === "photo") photoLayout(preview, f, alive, nav);
    else if (f.kind === "video" || (f.kind === "pdf" && navigator.pdfViewerEnabled)) stripLayout(preview, f, alive, nav);
    else cardLayout(preview, f, alive, nav);
}

// ---------- Next / previous ----------

// go(-1 / +1), elements() for the arrows and the "3 / 12" counter (new ones each time, one set per layout),
// and preload() to download the photos next to this one, so going there is instant
function navigation(f, browse) {
    const list = browse?.list ?? [];
    const index = list.findIndex((x) => x.id === f.id);
    const neighbour = (dir) => (index < 0 ? null : list[index + dir] ?? null);

    // replace: Back closes the file instead of stepping through every file looked at
    const go = (dir) => {
        const target = neighbour(dir);
        if (!target) return;
        slideDirection = dir;
        goTo(browse.hrefFor(target), { replace: true });
    };

    const elements = () => {
        if (index < 0 || list.length < 2) return [];
        const parts = [];
        if (neighbour(-1)) parts.push(arrow("back", "Previous file", "prev", () => go(-1)));
        if (neighbour(1)) parts.push(arrow("forward", "Next file", "next", () => go(1)));
        const counter = document.createElement("div");
        counter.className = "preview-counter";
        counter.textContent = (index + 1) + " / " + list.length;
        parts.push(counter);
        return parts;
    };

    const preload = () => {
        for (const other of [neighbour(1), neighbour(-1)]) {
            if (other?.kind !== "photo") continue;
            if (other.source === "link") {
                new Image().src = other.url;
            } else {
                const { thumb, display, original } = other.storage;
                for (const version of [display ?? original, thumb]) {
                    if (version) blobUrl(version.path).catch(() => { }); // blobUrl keeps it, so the viewer gets it straight away
                }
            }
        }
    };

    return { go, elements, preload };
}

// Both on top of each other for a moment: the old file slides a little away and fades out,
// the new one slides in from the side you're going to (the right for next)
function slide(old, preview, dir) {
    old.classList.add("leaving");
    const away = "translateX(" + -dir * SLIDE.distance + "px)";
    const from = "translateX(" + dir * SLIDE.distance + "px)";
    old.animate([{ transform: "none", opacity: 1 }, { transform: away, opacity: 0 }], { duration: SLIDE.duration, easing: "ease-in" })
        .finished.catch(() => { }).then(() => old.remove());
    preview.animate([{ transform: from, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: SLIDE.duration, easing: "ease-out" });
}

// A hidden screen keeps its contents, so a video would keep playing after leaving it.
// After every change of address (once the router has shown the new screen), empty viewers that are out of sight.
window.addEventListener("hashchange", () => setTimeout(() => {
    for (const container of containers) {
        if (container.clientWidth) continue;
        container.fileViewToken = null;
        container.replaceChildren();
        containers.delete(container);
    }
}));

function arrow(iconName, label, side, onclick) {
    const button = iconButton(iconName, label, onclick);
    button.classList.add("preview-arrow", side);
    return button;
}

// ← and →, unless someone's typing, a popup is open, or a video / audio player has focus (it uses them to skip)
document.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!keyTarget?.alive() || !keyTarget.container.clientWidth) return; // gone, or on a hidden screen
    if (e.target.closest?.("input, textarea, select, video, audio, [contenteditable]") || document.querySelector("dialog[open]")) return;
    e.preventDefault();
    keyTarget.nav.go(e.key === "ArrowLeft" ? -1 : 1);
});

// A sideways swipe with one finger. allowed(): checked when the finger goes down (e.g. not while zoomed in).
// Not on a video or audio player: there a sideways drag moves through the recording.
function onSwipe(el, go, allowed = () => true) {
    let start = null;
    el.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "touch") return;
        if (e.target.closest("video, audio, input")) return;
        start = start ? "several" : { x: e.clientX, y: e.clientY, allowed: allowed() }; // a second finger: a pinch, not a swipe
    });
    el.addEventListener("pointerup", (e) => {
        if (e.pointerType !== "touch") return;
        const s = start;
        start = null;
        if (!s || s === "several" || !s.allowed) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
    });
    el.addEventListener("pointercancel", () => { start = null; });
}

// Runs `use(src)` when the download is ready, unless something else is shown by then
function load(promise, alive, use, onError) {
    promise.then((src) => { if (alive()) use(src); }).catch((error) => {
        console.error("Could not load file:", error);
        if (alive()) onError(error);
    });
}

// ---------- Photo ----------

function photoLayout(preview, f, alive, nav) {
    preview.classList.add("photo");

    // The blurred copy behind: the small thumbnail is plenty, and is usually downloaded already for the file list
    const backdrop = document.createElement("img");
    backdrop.className = "preview-backdrop";
    backdrop.alt = "";
    backdrop.referrerPolicy = "no-referrer";

    const stage = document.createElement("div");
    stage.className = "preview-stage";
    const img = document.createElement("img");
    img.className = "preview-photo";
    img.alt = f.title;
    img.referrerPolicy = "no-referrer";
    img.draggable = false;
    img.hidden = true; // until it's loaded and fitted
    stage.append(img);

    const overlay = document.createElement("div");
    overlay.className = "preview-overlay";
    const text = caption(f, { date: true, description: true });
    if (text) overlay.append(text);
    overlay.append(...nav.elements()); // the arrows fade away together with the rest

    preview.append(backdrop, stage, overlay);

    let isFitted = () => true; // swiping only while the whole photo is in view; zoomed in, a drag moves the photo
    onSwipe(preview, nav.go, () => isFitted()); // on the photo and on the caption

    const failed = () => {
        preview.replaceChildren();
        preview.classList.remove("photo");
        cardLayout(preview, f, alive, nav, "No preview available. Download the file to view it.");
    };
    img.onerror = failed;
    img.onload = () => {
        img.hidden = false;
        isFitted = startZooming(stage, img);
        nav.preload(); // only now, so the neighbours don't slow this photo down
    };
    if (f.source === "link") {
        img.src = backdrop.src = f.url;
    } else {
        const { thumb, display, original } = f.storage;
        load(blobUrl((display ?? original).path), alive, (src) => { img.src = src; }, failed);
        load(blobUrl((thumb ?? display ?? original).path), alive, (src) => { backdrop.src = src; }, () => { });
    }

    autoHide(preview, stage, overlay, alive);
}

// The photo's position and zoom. `scale` is in screen pixels per photo pixel; `fit` shows the whole photo.
// Small photos aren't blown up beyond their real size. Returns isFitted(): not zoomed in.
function startZooming(stage, img) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    let view = { x: 0, y: 0, scale: 1 };
    let fit = 1;

    const apply = (animate) => {
        img.style.transition = animate ? "transform 250ms ease" : "none";
        img.style.transform = "translate(" + view.x + "px, " + view.y + "px) scale(" + view.scale + ")";
        stage.classList.toggle("zoomed", view.scale > fit * 1.01); // the "grab" hand: there's something to drag
    };
    // Keeps the photo in view: centred while it's smaller than the stage, otherwise no empty space at the edges
    const set = (x, y, scale, animate) => {
        const keep = (pos, size, room) => (size <= room ? (room - size) / 2 : Math.min(0, Math.max(room - size, pos)));
        view = { x: keep(x, w * scale, stage.clientWidth), y: keep(y, h * scale, stage.clientHeight), scale };
        apply(animate);
    };
    const reset = (animate = false) => {
        fit = Math.min(stage.clientWidth / w, stage.clientHeight / h, 1);
        set(0, 0, fit, animate);
    };

    const { zoomTo, wasDragged } = panZoom(stage, {
        view: () => view,
        set,
        minZoom: () => fit,
        maxZoom: () => Math.max(fit * 4, 1.5),
    });
    reset();
    new ResizeObserver(() => { if (stage.clientWidth) reset(); }).observe(stage);

    // Double click / double tap: zoom in on that spot, or back out to the whole photo.
    // A single tap is handled in autoHide (it shows or hides the overlay); it waits to see if a second tap follows.
    stage.addEventListener("click", (e) => {
        if (wasDragged()) return;
        if (stage.tapTimer) {
            clearTimeout(stage.tapTimer);
            stage.tapTimer = null;
            const rect = stage.getBoundingClientRect();
            if (view.scale > fit * 1.01) reset(true);
            else zoomTo(fit * DOUBLE_TAP_ZOOM, e.clientX - rect.left, e.clientY - rect.top, true);
            return;
        }
        stage.tapTimer = setTimeout(() => {
            stage.tapTimer = null;
            stage.dispatchEvent(new CustomEvent("singletap"));
        }, DOUBLE_TAP);
    });
    return () => view.scale <= fit * 1.01;
}

// The overlay fades out after a while without mouse movement (the mouse pointer too), and comes back when
// the mouse moves. A tap shows it, or hides it when it's showing. It stays while the mouse is on it.
function autoHide(preview, stage, overlay, alive) {
    let timer = null;
    let overOverlay = false;
    const hide = () => preview.classList.add("idle");
    const show = () => {
        preview.classList.remove("idle");
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (alive() && !overOverlay) hide();
        }, IDLE_TIME);
    };

    preview.addEventListener("pointermove", (e) => {
        if (e.pointerType === "mouse") show();
    });
    overlay.addEventListener("pointerover", () => { overOverlay = true; });
    overlay.addEventListener("pointerout", (e) => {
        if (!overlay.contains(e.relatedTarget)) overOverlay = false;
    });
    stage.addEventListener("singletap", () => {
        if (preview.classList.contains("idle")) show();
        else hide();
    });
    show();
}

// ---------- Video and PDF ----------

function stripLayout(preview, f, alive, nav) {
    preview.classList.add("strip", f.kind);
    const media = document.createElement("div");
    media.className = "preview-media";
    preview.append(media);
    const text = caption(f, { date: true, description: true });
    if (text) preview.append(text);
    // Halfway up the whole viewer, like for photos and cards, so the arrows stay in the same spot when clicking through.
    // The strip is at most 40% high, so that's still beside the video / PDF.
    preview.append(...nav.elements());
    // Only outside YouTube and the PDF: touches inside an iframe never reach this page
    onSwipe(preview, nav.go);
    nav.preload();

    const failed = (error) => media.replaceChildren(note(friendlyError(error)));
    const url = f.url;
    const original = f.storage?.original.path;

    if (f.kind === "video" && f.source === "link" && youTubeId(url)) {
        // youtube-nocookie: YouTube only sets cookies once someone presses play
        const frame = document.createElement("iframe");
        frame.src = "https://www.youtube-nocookie.com/embed/" + youTubeId(url);
        frame.allow = "fullscreen; picture-in-picture";
        frame.referrerPolicy = "strict-origin-when-cross-origin";
        frame.title = f.title;
        media.append(frame);
    } else if (f.kind === "video") {
        const video = document.createElement("video");
        video.controls = true;
        if (f.source === "link") video.src = url;
        else load(blobUrl(original), alive, (src) => { video.src = src; }, failed);
        media.append(video);
    } else {
        // The browser's own PDF viewer (only used when the browser says it has one: most phones don't)
        const frame = document.createElement("iframe");
        frame.title = f.title;
        if (f.source === "link") frame.src = url;
        else load(blobUrl(original), alive, (src) => { frame.src = src; }, failed);
        media.append(frame);
    }
}

// ---------- Websites, audio and other files ----------

function cardLayout(preview, f, alive, nav, message = null) {
    preview.classList.add("card");
    const card = document.createElement("div");
    card.className = "preview-card";

    const emoji = document.createElement("div");
    emoji.className = "preview-icon";
    emoji.textContent = KIND_ICONS[f.kind];
    const name = document.createElement("h2");
    name.textContent = f.title;
    card.append(emoji, name);

    if (f.source === "link") card.append(line("preview-domain", new URL(f.url).hostname));
    if (f.date) card.append(line("preview-date", formatDate(f.date)));

    if (f.kind === "audio") {
        const audio = document.createElement("audio");
        audio.controls = true;
        if (f.source === "link") audio.src = f.url;
        else load(blobUrl(f.storage.original.path), alive, (src) => { audio.src = src; }, (error) => audio.replaceWith(note(friendlyError(error))));
        card.append(audio);
    }
    if (f.description) card.append(...clamped(f.description));
    if (message) card.append(note(message));
    if (f.kind !== "audio") card.append(cardButton(f));

    preview.append(card);
    const people = caption(f, {});
    if (people) preview.append(people);
    preview.append(...nav.elements());
    onSwipe(preview, nav.go);
    nav.preload();
}

// Visit the website, open a linked file, or download an uploaded one
function cardButton(f) {
    const button = document.createElement("a");
    button.className = "button";
    if (f.source === "link") {
        button.href = f.url;
        button.target = "_blank";
        button.rel = "noopener noreferrer";
        button.append(icon("external"), f.kind === "website" ? "Visit website" : f.kind === "pdf" ? "Open PDF" : "Open link");
    } else {
        const { original } = f.storage;
        button.href = "#";
        button.onclick = (e) => {
            e.preventDefault();
            downloadFile(original.path, original.name).catch((error) => alert(friendlyError(error)));
        };
        button.append(icon("download"), "Download");
    }
    return button;
}

// ---------- Shared ----------

// Date, description and the people in the file: in the overlay, the strip, or under the card.
// Returns null when there's nothing to show.
function caption(f, { date = false, description = false }) {
    const parts = [];
    if (date && f.date) parts.push(line("preview-date", formatDate(f.date)));
    if (description && f.description) parts.push(...clamped(f.description));

    const people = f.people.map(getPerson).filter(Boolean);
    if (people.length > 0) {
        const label = line("preview-people-label", "People tagged in this " + TAG_WORDS[f.kind] + ":");
        const pills = document.createElement("div");
        pills.className = "preview-pills";
        pills.append(...people.map((p) => {
            const a = document.createElement("a");
            a.className = "pill";
            a.href = "#/person/" + encodeURIComponent(p.id);
            a.textContent = fullName(p);
            return a;
        }));
        parts.push(label, pills);
    }
    if (parts.length === 0) return null;

    const box = document.createElement("div");
    box.className = "preview-caption";
    box.append(...parts);
    return box;
}

// A description cut off after 3 lines, with "see more…" / "see less…" (only when it really is cut off)
function clamped(text) {
    const p = line("preview-description clamped", text);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "link-button";
    toggle.textContent = "see more…";
    toggle.hidden = true;
    toggle.onclick = () => {
        const open = !p.classList.toggle("clamped");
        toggle.textContent = open ? "see less…" : "see more…";
    };
    // Whether it's cut off is only known once it's on screen (and changes with the width)
    new ResizeObserver(() => {
        if (!p.clientHeight || !p.classList.contains("clamped")) return;
        toggle.hidden = p.scrollHeight <= p.clientHeight + 1;
    }).observe(p);
    return [p, toggle];
}

function line(className, text) {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    return p;
}

function note(text) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = text;
    return p;
}
