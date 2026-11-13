import { goTo } from "./router.js";
import { $ } from "./ui.js";
import { lifespan } from "./dates.js";
import { getPerson, getPersons, getRelations, getHomePersonId, getLastSelected, setLastSelected } from "./store.js";
import { fullName, compareByName } from "./names.js";
import { layoutTree, BOX_W, BOX_H } from "./treeLayout.js";
import { relationshipLabeler } from "./relationships.js";
import { iconButton } from "./icons.js";
import { openPicker } from "./picker.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const DRAG_THRESHOLD = 6; // pixels; moving less than this still counts as a click
const DURATION = 300; // ms: sliding the clicked box to the middle (and fading out the old tree)
const EASE = DURATION + "ms ease";
const LINE_TIME = 20; // ms: drawing one line of the build-up (one time step in treeLayout.js)
const GROW_TIME = 100; // ms: a box growing in once its line reaches it
const CHIP_H = 18;     // the "↑ 12" chips sit half over the top or bottom edge of a box
const CHIP_RIGHT = 14; // distance from the box's right edge, away from where lines connect

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.5;
const ZOOM_KEY = "family-tree-zoom"; // remembered per browser

let offset = { x: 0, y: 0 }; // where the layer's (0, 0) is on screen; (0, 0) = the selected person
let scale = readZoom();      // 1 = 100%. A point (x, y) in the tree is on screen at offset + (x, y) * scale
let currentNodes = [];       // the boxes of the tree on screen now (for search: is that person visible?)
let currentBoxes = [];       // their elements, in the same order
let building = [];           // the running build-up animations
let clickedId = null;        // the person whose box was just slid to the middle: it's already there, so it doesn't grow in
let sliding = false;         // true while sliding, so a second click can't start another one
let dragged = false;
let canvasSize = null;       // last known size, to keep the middle in place when the window resizes

// When #/tree has no (valid) id: the last selected person, then the home person, then the first alphabetically
function startPersonId() {
    for (const id of [getLastSelected(), getHomePersonId()]) {
        if (id && getPerson(id)) return id;
    }
    return getPersons().sort(compareByName)[0]?.id ?? null;
}

export function renderTree(id) {
    if (!id || !getPerson(id)) {
        const start = startPersonId();
        if (start) {
            goTo("#/tree/" + encodeURIComponent(start), { replace: true });
        } else {
            $("tree-empty").hidden = false;
            $("tree-canvas").hidden = true;
        }
        return;
    }

    setLastSelected(id);
    $("tree-empty").hidden = true;
    $("tree-canvas").hidden = false;
    $("top-actions").replaceChildren(iconButton("search", "Find a person", findPerson));

    const persons = new Map(getPersons().map((p) => [p.id, p]));
    const { nodes, lines } = layoutTree(id, persons, getRelations());
    const labelOf = relationshipLabeler(id, persons, getRelations());
    const svg = drawLines(lines);
    const badges = drawBadges(nodes);
    const boxes = nodes.map((n) => drawBox(n, labelOf(n.id)));
    $("tree-layer").replaceChildren(svg, badges, ...boxes);

    currentNodes = nodes;
    currentBoxes = boxes;

    const canvas = $("tree-canvas");
    canvasSize = { w: canvas.clientWidth, h: canvas.clientHeight };
    const center = centeredOffset();
    setOffset(center.x, center.y);

    const alreadyThere = clickedId === id;
    clickedId = null;
    building = reducedMotion() ? [] : buildUp(svg, badges, boxes, nodes, lines, alreadyThere);
}

// Draws the tree outward from the selected person: each line draws itself (when what it grows out of is there),
// and each box grows in when its line reaches it. The times come from treeLayout.js; the "more" chips come last.
// Lines draw with the dash trick: with pathLength 1 and a dash as long as the whole line, shifting the dash
// from 1 to 0 makes the line appear from its first point to its last.
// fill "backwards" = before its turn, everything already looks like the start (hidden).
function buildUp(svg, badges, boxes, nodes, lines, keepSelected) {
    const animations = [];
    lines.forEach((line, i) => {
        animations.push(svg.children[i].animate(
            [{ strokeDashoffset: "1" }, { strokeDashoffset: "0" }],
            { duration: LINE_TIME, delay: line.start * LINE_TIME, fill: "backwards" }, // linear, so connected lines flow on smoothly
        ));
    });
    nodes.forEach((n, i) => {
        if (n.selected && keepSelected) return;
        animations.push(boxes[i].animate(
            [{ opacity: 0, transform: "scale(0.5)", filter: "blur(7px)" }, { opacity: 1, transform: "none", filter: "none" }],
            { duration: GROW_TIME, delay: n.appear * LINE_TIME, easing: "ease-out", fill: "backwards" },
        ));
    });
    const lastStep = Math.max(0, ...lines.map((l) => l.start + 1), ...nodes.map((n) => n.appear));
    animations.push(badges.animate([{ opacity: 0 }, { opacity: 1 }], { duration: GROW_TIME, delay: lastStep * LINE_TIME, fill: "backwards" }));
    return animations;
}

// Fades out the tree on screen, except `keep` (the clicked box). A build-up that's still going stops where it is.
function fadeOutTree(keep) {
    building.forEach((a) => a.pause());
    keep?.getAnimations().forEach((a) => a.finish()); // a box clicked while growing in: full size straight away
    const layer = $("tree-layer");
    const old = document.createElement("div");
    old.append(...[...layer.children].filter((el) => el !== keep));
    layer.append(old);
    // Shrink toward the middle of the clicked box, or (search) the middle of the screen. In tree pixels.
    const canvas = $("tree-canvas");
    const origin = keep
        ? { x: parseFloat(keep.style.left) + keep.offsetWidth / 2, y: parseFloat(keep.style.top) + BOX_H / 2 }
        : { x: (canvas.clientWidth / 2 - offset.x) / scale, y: (canvas.clientHeight / 2 - offset.y) / scale };
    old.style.transformOrigin = origin.x + "px " + origin.y + "px";
    old.animate([{ opacity: 1, filter: "blur(0px)", transform: "scale(1)" }, { opacity: 0, filter: "blur(7px)", transform: "scale(0.75)" }], { duration: DURATION, fill: "forwards" });
}

function reducedMotion() {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// "↑ 12" on the top edge and "↓ 5" on the bottom edge of a box, near its right corner.
// Lines only ever connect at the middle or the sides of a box, so that spot is always free.
function drawBadges(nodes) {
    const container = document.createElement("div");
    for (const node of nodes) {
        for (const [more, up] of [[node.moreUp, true], [node.moreDown, false]]) {
            if (!more) continue;
            const badge = document.createElement("button");
            badge.type = "button";
            badge.className = "tree-more";
            badge.textContent = (up ? "↑ " : "↓ ") + more.people;
            badge.title = more.people + " more " + (up ? "ancestor" : "descendant") + (more.people === 1 ? "" : "s")
                + ", " + more.generations + " generation" + (more.generations === 1 ? "" : "s");
            badge.style.left = node.x + node.width - CHIP_RIGHT + "px"; // its right side, via CSS translateX(-100%)
            badge.style.top = (up ? node.y : node.y + BOX_H) - CHIP_H / 2 + "px";
            badge.style.height = CHIP_H + "px";
            badge.onclick = () => selectFromTree(node);
            container.append(badge);
        }
    }
    return container;
}

// The 🔍 in the top bar: the same popup as for picking relatives, without "+ New person".
// The chosen person becomes the middle of the tree: with the slide if they're visible now, otherwise
// the tree fades out and theirs builds up from the middle.
function findPerson() {
    openPicker({
        title: "Find a person",
        exclude: new Set(),
        allowNew: false,
        onPick: async ({ id }) => {
            const visible = currentNodes.find((n) => n.id === id && !n.selected);
            moveTo(id, visible ?? null);
        },
    });
}

function selectFromTree(node) {
    moveTo(node.id, node);
}

// Makes `id` the selected person. With `node` (their box on screen): the tree slides until that box is in
// the middle, while everything else fades out. Then the new tree builds up around it (renderTree).
function moveTo(id, node) {
    if (sliding) return;
    const target = "#/tree/" + encodeURIComponent(id);
    if (reducedMotion()) {
        goTo(target, { replace: true });
        return;
    }

    sliding = true;
    fadeOutTree(node ? currentBoxes[currentNodes.indexOf(node)] : null);
    if (node) {
        // Slide to where the selected box will be, so the new tree starts without a jump
        const center = centeredOffset();
        setOffset(center.x - node.x * scale, center.y - node.y * scale, true);
    }
    setTimeout(() => {
        sliding = false;
        if (node) clickedId = id;
        goTo(target, { replace: true });
    }, DURATION);
}

function drawLines(lines) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.id = "tree-lines";
    svg.setAttribute("width", "1");
    svg.setAttribute("height", "1");
    for (const { points } of lines) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", "M" + points.map(([x, y]) => x + " " + y).join(" L"));
        // For drawing the line in buildUp: its length counts as 1, and it's one dash that long
        path.setAttribute("pathLength", "1");
        path.style.strokeDasharray = "1";
        svg.append(path);
    }
    return svg;
}

function drawBox(node, label) {
    const p = getPerson(node.id);
    // The selected box is one big link to the details page; the others are buttons that select someone
    const box = document.createElement(node.selected ? "a" : "button");
    if (node.selected) {
        box.href = "#/person/" + encodeURIComponent(node.id);
        box.draggable = false; // otherwise the browser drags the link itself instead of the tree
    } else {
        box.type = "button";
        box.onclick = () => selectFromTree(node);
    }
    box.className = "tree-box" + (node.selected ? " selected" : "") + (node.duplicate ? " duplicate" : "");
    box.style.left = node.x + "px";
    box.style.top = node.y + "px";
    box.style.width = node.width + "px";
    box.style.height = BOX_H + "px";
    if (node.duplicate) box.title = "This person appears more than once in this tree";

    const name = document.createElement("div");
    name.className = "tree-name";
    name.textContent = fullName(p);
    const meta = document.createElement("div");
    meta.className = "tree-meta";
    meta.textContent = [label, lifespan(p)].filter(Boolean).join(" • "); // "Grandfather • 1890 – 1960"
    const text = document.createElement("div");
    text.className = "tree-text";
    text.append(name, meta);
    // The selected box: "View details ›" under the name and years (it has no relationship label, so there's room)
    if (node.selected) {
        const details = document.createElement("span");
        details.className = "tree-details";
        details.append("View details", chevron());
        text.append(details);
    }
    const info = document.createElement("div");
    info.className = "tree-info";
    info.append(avatar(p), text);
    box.append(info);
    return box;
}

// The round profile photo, or grey initials when there is none. The photo is stored in the
// person document itself, so this never has to download anything.
function avatar(p) {
    const el = document.createElement("div");
    el.className = "tree-avatar";
    if (p.photo?.avatar) {
        const img = document.createElement("img");
        img.src = p.photo.avatar;
        img.alt = "";
        el.append(img);
    } else {
        el.textContent = initials(p);
    }
    return el;
}

// "Johannes Pieter van den Berg" -> "JB": first given name, and the surname without "van den"
function initials(p) {
    const given = p.givenNames?.[0] ?? "";
    const surnameWord = p.surname?.split(/\s+/).find((w) => /^\p{Lu}/u.test(w)) ?? p.surname ?? "";
    return (given + (surnameWord[0] ?? "")).toUpperCase() || "?";
}

// A ">" icon as a small SVG, so it stays sharp at any size
function chevron() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "chevron");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M9 6l6 6-6 6");
    svg.append(path);
    return svg;
}

function setOffset(x, y, animate = false) {
    offset = { x, y };
    const layer = $("tree-layer");
    layer.style.transition = animate ? "transform " + EASE : "none";
    layer.style.transform = "translate(" + x + "px, " + y + "px) scale(" + scale + ")";
}

// The offset that puts the selected box, at (0, 0) in the tree, in the middle of the canvas
function centeredOffset() {
    const canvas = $("tree-canvas");
    return { x: canvas.clientWidth / 2 - BOX_W / 2 * scale, y: canvas.clientHeight / 2 - BOX_H / 2 * scale };
}

// ---------- Zooming ----------

// Zooms to `newScale` while the point (px, py) on the canvas stays where it is (under the mouse, between the fingers).
// That point is (p - offset) / scale in the tree; keeping it under p gives: offset = p - (p - offset) * new / old.
function zoomTo(newScale, px, py, animate = false) {
    newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newScale));
    const ratio = newScale / scale;
    scale = newScale;
    setOffset(px - (px - offset.x) * ratio, py - (py - offset.y) * ratio, animate);
    zoomChanged();
}

function zoomChanged() {
    try {
        localStorage.setItem(ZOOM_KEY, String(scale));
    } catch { }
    updateZoomButtons();
}

function readZoom() {
    try {
        const saved = Number(localStorage.getItem(ZOOM_KEY));
        return saved >= MIN_ZOOM && saved <= MAX_ZOOM ? saved : 1;
    } catch {
        return 1;
    }
}

// + and - zoom around the middle of the canvas. The third button puts the selected person back in the
// middle; pressed again when they already are, it goes back to 100%.
function zoomButtons() {
    const canvas = $("tree-canvas");
    const step = (factor) => () => zoomTo(scale * factor, canvas.clientWidth / 2, canvas.clientHeight / 2, true);
    const center = () => {
        const c = centeredOffset();
        const alreadyCentered = Math.abs(offset.x - c.x) < 1 && Math.abs(offset.y - c.y) < 1;
        if (alreadyCentered) zoomTo(1, canvas.clientWidth / 2, canvas.clientHeight / 2, true); // the middle stays the middle
        else setOffset(c.x, c.y, true);
    };
    const controls = document.createElement("div");
    controls.id = "tree-controls";
    controls.append(
        iconButton("plus", "Zoom in", step(1.25)),
        iconButton("minus", "Zoom out", step(1 / 1.25)),
        iconButton("center", "Back to the selected person (press again for 100%)", center),
    );
    // Pressing a button shouldn't start dragging the tree, and is always a click
    // (after a pinch `dragged` can still be true, because a pinch doesn't end with a click)
    controls.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        dragged = false;
    });
    return controls;
}

function updateZoomButtons() {
    const [plus, minus] = document.querySelectorAll("#tree-controls button");
    if (!plus) return;
    plus.disabled = scale >= MAX_ZOOM - 0.001;
    minus.disabled = scale <= MIN_ZOOM + 0.001;
}

// ---------- Dragging and pinching ----------

export function initTree() {
    const canvas = $("tree-canvas");
    canvas.append(zoomButtons());
    updateZoomButtons();

    // Every finger (or the mouse button) that's down on the canvas, and the gesture they started.
    // One pointer drags; two pinch (zoom) and drag at the same time, following the point between them.
    const pointers = new Map(); // pointerId -> { x, y } on the canvas
    let gesture = null;
    const toCanvas = (e) => {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    // Called whenever a finger is added or lifted: start over from where things are now
    const startGesture = () => {
        const [a, b] = pointers.values();
        if (!a) gesture = null;
        else if (!b) gesture = { type: "drag", start: a, offset: { ...offset } };
        else gesture = {
            type: "pinch",
            distance: Math.hypot(a.x - b.x, a.y - b.y),
            middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            offset: { ...offset },
            scale,
        };
    };

    canvas.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return; // left mouse button, or a finger
        if (pointers.size === 0) dragged = false;
        pointers.set(e.pointerId, toCanvas(e));
        if (pointers.size === 2) {
            dragged = true; // a pinch is never a click
            canvas.classList.add("dragging");
        }
        startGesture();
    });

    canvas.addEventListener("pointermove", (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, toCanvas(e));

        if (gesture?.type === "drag") {
            const now = pointers.get(e.pointerId);
            const dx = now.x - gesture.start.x;
            const dy = now.y - gesture.start.y;
            if (!dragged) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                dragged = true;
                canvas.setPointerCapture(e.pointerId); // keep getting moves, even outside the canvas
                canvas.classList.add("dragging");
            }
            setOffset(gesture.offset.x + dx, gesture.offset.y + dy);
        } else if (gesture?.type === "pinch") {
            const [a, b] = pointers.values();
            const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance));
            // The tree point that was between the fingers at the start stays between them
            const treeX = (gesture.middle.x - gesture.offset.x) / gesture.scale;
            const treeY = (gesture.middle.y - gesture.offset.y) / gesture.scale;
            scale = newScale;
            setOffset(middle.x - treeX * scale, middle.y - treeY * scale);
            zoomChanged();
        }
    });

    const lift = (e) => {
        if (!pointers.delete(e.pointerId)) return;
        startGesture(); // e.g. one finger left after a pinch: continue as a drag from here
        if (pointers.size === 0) canvas.classList.remove("dragging");
    };
    canvas.addEventListener("pointerup", lift);
    canvas.addEventListener("pointercancel", lift);

    // Mouse wheel zooms around the mouse. A trackpad pinch arrives as a wheel event with ctrlKey and small steps.
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault(); // don't scroll the page
        const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // some mice report lines instead of pixels
        const factor = Math.exp(-pixels * (e.ctrlKey ? 0.01 : 0.0015));
        const p = toCanvas(e);
        zoomTo(scale * factor, p.x, p.y);
    }, { passive: false });

    // A drag that happens to end on a box should not also select that box.
    // `true` = capture phase: this runs before the box's own click handler.
    canvas.addEventListener("click", (e) => {
        if (!dragged) return;
        e.stopPropagation();
        e.preventDefault();
        dragged = false;
    }, true);

    // When the window changes size, keep the same spot in the middle.
    // Size 0 means the tree is hidden (another screen is open); renderTree re-centers when it comes back.
    new ResizeObserver(() => {
        const now = { w: canvas.clientWidth, h: canvas.clientHeight };
        if (!now.w || !canvasSize) return;
        setOffset(offset.x + (now.w - canvasSize.w) / 2, offset.y + (now.h - canvasSize.h) / 2);
        canvasSize = now;
    }).observe(canvas);
}
