// Small line icons as SVG, so they stay sharp at any size and take the text colour.
// Each is a list of SVG path drawings on a 24x24 grid.

const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS = {
    back: ["M15 6l-6 6 6 6"],
    close: ["M6 6l12 12", "M18 6L6 18"],
    plus: ["M12 5v14", "M5 12h14"],
    search: ["M4 11a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "M16 16l4 4"], // a magnifying glass
    minus: ["M5 12h14"],
    center: ["M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0", "M12 3v3", "M12 18v3", "M3 12h3", "M18 12h3"], // a circle with marks: "aim"
    home: ["M4 11l8-7 8 7", "M6 9.5V20h12V9.5", "M10 20v-6h4v6"], // roof, walls, door
    tree: ["M9 3h6v5H9z", "M12 8v3", "M6 14v-3h12v3", "M3 14h6v6H3z", "M15 14h6v6h-6z"], // one box above two

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
