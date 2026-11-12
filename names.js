// "Johannes Pieter (Jan) Keim"
export function fullName(p) {
    return [p.givenNames, p.nickname ? "(" + p.nickname + ")" : "", p.surname].filter(Boolean).join(" ");
}

// "Keim, Johannes Pieter (Jan)", for sorted lists
export function listName(p) {
    return p.surname + ", " + [p.givenNames, p.nickname ? "(" + p.nickname + ")" : ""].filter(Boolean).join(" ");
}

// "van den Berg" -> "Berg", "'t Hart" -> "Hart", "Van Buren" stays "Van Buren"
function sortSurname(surname) {
    const words = surname.split(/\s+/);
    const isLower = (w) => w === w.toLowerCase() && w !== w.toUpperCase();
    const first = words.findIndex((w) => !isLower(w));
    return first === -1 ? surname : words.slice(first).join(" ");
}

export function compareByName(a, b) {
    const opts = { sensitivity: "base" }; // ignores case and accents
    return sortSurname(a.surname).localeCompare(sortSurname(b.surname), undefined, opts)
        || a.givenNames.localeCompare(b.givenNames, undefined, opts);
}
