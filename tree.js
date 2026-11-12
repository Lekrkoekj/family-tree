import { goTo } from "./router.js";
import { $ } from "./ui.js";
import { lifespan } from "./dates.js";
import { getPerson, getPersons, getRelations, getHomePersonId, getLastSelected, setLastSelected } from "./store.js";
import { fullName, compareByName } from "./names.js";
import { layoutTree, BOX_W, BOX_H, SELECTED_W } from "./treeLayout.js";
import { relationshipLabeler } from "./relationships.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const DRAG_THRESHOLD = 6; // pixels; moving less than this still counts as a click
const DURATION = 300; // ms, for each of the two animation phases
const EASE = DURATION + "ms ease";

let offset = { x: 0, y: 0 }; // where the layer's (0, 0) is on screen; (0, 0) = the selected person
let shown = new Map();       // id -> { x, y } of the boxes on screen now
let clicked = null;          // { id, x, y } of the box that was clicked, for the build-up animation
let sliding = false;         // true during phase 1, so a second click can't start another one
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

    const persons = new Map(getPersons().map((p) => [p.id, p]));
    const { nodes, lines } = layoutTree(id, persons, getRelations());
    const labelOf = relationshipLabeler(id, persons, getRelations());
    const svg = drawLines(lines);
    const boxes = nodes.map((n) => drawBox(n, labelOf(n.id)));
    $("tree-layer").replaceChildren(svg, ...boxes);

    const previous = shown;
    shown = new Map();
    nodes.forEach((n) => { if (!shown.has(n.id)) shown.set(n.id, { x: n.x, y: n.y }); });

    const canvas = $("tree-canvas");
    canvasSize = { w: canvas.clientWidth, h: canvas.clientHeight };
    const center = { x: canvasSize.w / 2 - SELECTED_W / 2, y: canvasSize.h / 2 - BOX_H / 2 };
    const from = clicked?.id === id ? clicked : null;
    clicked = null;
    setOffset(center.x, center.y);
    if (!from) return;

    // Phase 2: phase 1 slid the clicked box to the middle, so on screen nothing should jump.
    // Every box starts where it was on screen and glides to its new place.
    // People who weren't visible yet start hidden in the middle and grow out from there.
    // Screen position = layer offset + box position. The offset was (center - from) and is now
    // center, so a box that was at `old` needs a start shift of old - from - new.
    nodes.forEach((n, i) => {
        const old = n.selected ? from : previous.get(n.id);
        const isFirst = shown.get(n.id).x === n.x && shown.get(n.id).y === n.y;
        if (old && (n.selected || isFirst)) {
            boxes[i].style.transform = "translate(" + (old.x - from.x - n.x) + "px, " + (old.y - from.y - n.y) + "px)";
        } else {
            boxes[i].style.transform = "translate(" + -n.x + "px, " + -n.y + "px) scale(0.5)";
            boxes[i].style.opacity = "0";
        }
    });
    svg.style.opacity = "0";

    $("tree-layer").getBoundingClientRect(); // forces the browser to apply the start positions first
    for (const box of boxes) {
        box.style.transition = "transform " + EASE + ", opacity " + EASE;
        box.style.transform = "";
        box.style.opacity = "";
    }
    svg.style.transition = "opacity " + EASE + " " + DURATION / 2 + "ms"; // lines appear once the boxes are on their way
    svg.style.opacity = "";
}

// Phase 1: slide the whole current tree until the clicked box is in the middle, then build the new tree
function selectFromTree(node) {
    if (sliding) return;
    const target = "#/tree/" + encodeURIComponent(node.id);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        goTo(target, { replace: true });
        return;
    }

    const canvas = $("tree-canvas");
    sliding = true;
    // Slide to where the (wider) selected box will be, so phase 2 starts without a jump
    setOffset(canvas.clientWidth / 2 - SELECTED_W / 2 - node.x, canvas.clientHeight / 2 - BOX_H / 2 - node.y, true);
    setTimeout(() => {
        sliding = false;
        clicked = { id: node.id, x: node.x, y: node.y };
        goTo(target, { replace: true });
    }, DURATION);
}

function drawLines(lines) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.id = "tree-lines";
    svg.setAttribute("width", "1");
    svg.setAttribute("height", "1");
    for (const points of lines) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", "M" + points.map(([x, y]) => x + " " + y).join(" L"));
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
    const info = document.createElement("div");
    info.className = "tree-info";
    info.style.width = BOX_W - 4 + "px"; // the same size in every box (minus room for the border), also in the wider selected one
    info.append(name, meta);
    box.append(info);

    if (node.selected) {
        const details = document.createElement("span");
        details.className = "tree-details";
        details.append("View details", chevron());
        box.append(details);
    }
    return box;
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
    layer.style.transform = "translate(" + x + "px, " + y + "px)";
}

// ---------- Dragging ----------

export function initTree() {
    const canvas = $("tree-canvas");
    let start = null;

    canvas.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return; // left mouse button, or a finger
        start = { pointer: e.pointerId, x: e.clientX, y: e.clientY, offsetX: offset.x, offsetY: offset.y };
        dragged = false;
    });

    canvas.addEventListener("pointermove", (e) => {
        if (!start || e.pointerId !== start.pointer) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (!dragged) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            dragged = true;
            canvas.setPointerCapture(e.pointerId); // keep getting moves, even outside the canvas
            canvas.classList.add("dragging");
        }
        setOffset(start.offsetX + dx, start.offsetY + dy);
    });

    const stop = () => {
        start = null;
        canvas.classList.remove("dragging");
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);

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
