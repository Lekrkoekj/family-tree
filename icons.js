// Small line icons as SVG, so they stay sharp at any size and take the text colour.
// Each is a list of SVG path drawings on a 24x24 grid.

const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS = {
    back: ["M15 6l-6 6 6 6"],
    close: ["M6 6l12 12", "M18 6L6 18"],
    download: ["M12 4v11", "M7 11l5 5 5-5", "M5 20h14"],
    pencil: ["M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z", "M14 7l3 3"],
    more: ["M6 12h.01", "M12 12h.01", "M18 12h.01"], // three dots (drawn as very short, thick lines)
    external: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
};

export function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (name === "more") svg.setAttribute("stroke-width", "3.5");
    for (const d of PATHS[name]) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        svg.append(path);
    }
    return svg;
}

// A round icon button, e.g. iconButton("pencil", "Edit", () => ...)
export function iconButton(name, label, onclick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.append(icon(name));
    if (onclick) button.onclick = onclick;
    return button;
}
