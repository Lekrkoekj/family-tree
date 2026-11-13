// Dragging, pinching and mouse-wheel zooming on an element: used by the family tree and the photo viewer.
// It only works out the new position and zoom; the caller shows it (and may adjust it, e.g. keep a photo in view).
//
// options:
//   view()                      the current { x, y, scale }: what's at point p in the content is on screen at (x, y) + p * scale
//   set(x, y, scale, animate)   show this view
//   minZoom, maxZoom            numbers, or functions that return one
// Returns { zoomTo(scale, px, py, animate), wasDragged() }.
// A drag (or pinch) never also counts as a click on whatever it ended on.

const DRAG_THRESHOLD = 6; // pixels; moving less than this still counts as a click

export function panZoom(el, { view, set, minZoom, maxZoom }) {
    const limit = (s) => Math.min(value(maxZoom), Math.max(value(minZoom), s));

    // Zooms to `newScale` while the point (px, py) on the element stays where it is (under the mouse, between the fingers).
    // That point is (p - x) / scale in the content; keeping it under p gives: x = p - (p - x) * new / old.
    const zoomTo = (newScale, px, py, animate = false) => {
        const v = view();
        newScale = limit(newScale);
        const ratio = newScale / v.scale;
        set(px - (px - v.x) * ratio, py - (py - v.y) * ratio, newScale, animate);
    };

    // Every finger (or the mouse button) that's down, and the gesture they started.
    // One pointer drags; two pinch (zoom) and drag at the same time, following the point between them.
    const pointers = new Map(); // pointerId -> { x, y } on the element
    let gesture = null;
    let dragged = false;
    const local = (e) => {
        const rect = el.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    // Called whenever a finger is added or lifted: start over from where things are now
    const startGesture = () => {
        const [a, b] = pointers.values();
        const v = view();
        if (!a) gesture = null;
        else if (!b) gesture = { type: "drag", start: a, view: v };
        else gesture = {
            type: "pinch",
            distance: Math.hypot(a.x - b.x, a.y - b.y),
            middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            view: v,
        };
    };

    // A new press starts fresh, also on buttons inside `el` that stop the event from reaching the listener below
    // (after a pinch `dragged` can still be true, because a pinch doesn't end with a click)
    el.addEventListener("pointerdown", () => {
        if (pointers.size === 0) dragged = false;
    }, true);

    el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return; // left mouse button, or a finger
        pointers.set(e.pointerId, local(e));
        if (pointers.size === 2) {
            dragged = true; // a pinch is never a click
            el.classList.add("dragging");
        }
        startGesture();
    });

    el.addEventListener("pointermove", (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, local(e));

        if (gesture?.type === "drag") {
            const now = pointers.get(e.pointerId);
            const dx = now.x - gesture.start.x;
            const dy = now.y - gesture.start.y;
            if (!dragged) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                dragged = true;
                el.setPointerCapture(e.pointerId); // keep getting moves, even outside the element
                el.classList.add("dragging");
            }
            set(gesture.view.x + dx, gesture.view.y + dy, gesture.view.scale, false);
        } else if (gesture?.type === "pinch") {
            const [a, b] = pointers.values();
            const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const { view: v } = gesture;
            const newScale = limit(v.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance);
            // The content point that was between the fingers at the start stays between them
            const cx = (gesture.middle.x - v.x) / v.scale;
            const cy = (gesture.middle.y - v.y) / v.scale;
            set(middle.x - cx * newScale, middle.y - cy * newScale, newScale, false);
        }
    });

    const lift = (e) => {
        if (!pointers.delete(e.pointerId)) return;
        startGesture(); // e.g. one finger left after a pinch: continue as a drag from here
        if (pointers.size === 0) el.classList.remove("dragging");
    };
    el.addEventListener("pointerup", lift);
    el.addEventListener("pointercancel", lift);

    // Mouse wheel zooms around the mouse. A trackpad pinch arrives as a wheel event with ctrlKey and small steps.
    el.addEventListener("wheel", (e) => {
        e.preventDefault(); // don't scroll the page
        const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // some mice report lines instead of pixels
        const factor = Math.exp(-pixels * (e.ctrlKey ? 0.01 : 0.0015));
        const p = local(e);
        zoomTo(view().scale * factor, p.x, p.y);
    }, { passive: false });

    // A drag that happens to end on something clickable should not also click it.
    // `true` = capture phase: this runs before that element's own click handler.
    el.addEventListener("click", (e) => {
        if (!dragged) return;
        e.stopPropagation();
        e.preventDefault();
        dragged = false;
    }, true);

    return { zoomTo, wasDragged: () => dragged };
}

function value(v) {
    return typeof v === "function" ? v() : v;
}
