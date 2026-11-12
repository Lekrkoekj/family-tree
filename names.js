// "Johannes Pieter (Jan) Keim"; unknown parts are simply left out ("Keim", "Johannes Pieter")
export function fullName(p) {
    return [p.givenNames, p.nickname ? "(" + p.nickname + ")" : "", p.surname].filter(Boolean).join(" ");
}

// "Keim, Johannes Pieter (Jan)", with a grey "(unknown)" for a missing surname or given names.
// Returns pieces to put in an element with .append(); plain strings become text, never HTML.
export function listName(p) {
    const given = [p.givenNames, p.nickname ? "(" + p.nickname + ")" : ""].filter(Boolean).join(" ");
    return [p.surname || unknown(), ", ", given || unknown()];
}

function unknown() {
    const span = document.createElement("span");
    span.className = "unknown";
    span.textContent = "(unknown)";
    return span;
}

// "van den Berg" -> "Berg", "'t Hart" -> "Hart", "Van Buren" stays "Van Buren"
function sortSurname(surname) {
    const words = surname.split(/\s+/);
    const isLower = (w) => w === w.toLowerCase() && w !== w.toUpperCase();
    const first = words.findIndex((w) => !isLower(w));
    return first === -1 ? surname : words.slice(first).join(" ");
}

// By surname (unknown surnames last), then given names
export function compareByName(a, b) {
    if (!a.surname !== !b.surname) return a.surname ? -1 : 1;

    const opts = { sensitivity: "base" }; // ignores case and accents
    const bySurname = a.surname ? sortSurname(a.surname).localeCompare(sortSurname(b.surname), undefined, opts) : 0;
    return bySurname || (a.givenNames ?? "").localeCompare(b.givenNames ?? "", undefined, opts);
}

// "José" -> "jose", so searching ignores accents and capitals
export function normalizeName(text) {
    return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(); // \p{M} = any accent mark
}

// People whose name contains every typed word ("jan ke" finds "Jan Keim"), sorted by name
export function searchPeople(people, text) {
    const words = normalizeName(text).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return people
        .filter((p) => words.every((w) => normalizeName(fullName(p)).includes(w)))
        .sort(compareByName);
}
