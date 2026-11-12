import { $ } from "./ui.js";

// Dates are stored as "YYYY", "YYYY-MM" or "YYYY-MM-DD" (the parts we know).

const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

export function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(year, month) {
    if (month === 2 && isLeapYear(year)) return 29;
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// "1931-05-12" -> "12 May 1931", "1931-05" -> "May 1931", "1931" -> "1931"
export function formatDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    if (!month) return String(year);
    if (!day) return MONTHS[month - 1] + " " + year;
    return day + " " + MONTHS[month - 1] + " " + year;
}

// Format: "1931 – 2005", "b. 1931", or "" when nothing is known
export function lifespan(p) {
    const birthYear = p.birthDate ? p.birthDate.slice(0, 4) : "?";
    if (p.deceased) {
        const deathYear = p.deathDate ? p.deathDate.slice(0, 4) : "?";
        return birthYear + " – " + deathYear;
    }
    return p.birthDate ? "b. " + birthYear : "";
}

// The first and last day a partial date could mean, as [year, month, day]
function bounds(value) {
    const [year, month, day] = value.split("-").map(Number);
    if (day) return { earliest: [year, month, day], latest: [year, month, day] };
    if (month) return { earliest: [year, month, 1], latest: [year, month, daysInMonth(year, month)] };
    return { earliest: [year, 1, 1], latest: [year, 12, 31] };
}

// Whole years between two [year, month, day] dates
function yearsBetween(from, to) {
    let years = to[0] - from[0];
    if (to[1] < from[1] || (to[1] === from[1] && to[2] < from[2])) years--;
    return years;
}

function today() {
    const now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

// "74", "73 or 74", or null when it can't be worked out.
// Living people: age today. Deceased people: age at death.
export function age(p) {
    if (!p.birthDate) return null;
    if (p.deceased && !p.deathDate) return null;

    const birth = bounds(p.birthDate);
    const end = bounds(p.deceased ? p.deathDate : today());
    const youngest = yearsBetween(birth.latest, end.earliest);
    const oldest = yearsBetween(birth.earliest, end.latest);
    return youngest === oldest ? String(oldest) : youngest + " or " + oldest;
}

// ---------- Date inputs (three boxes: <prefix>-day, -month, -year) ----------

// Reads the three inputs, e.g. "birth" -> birth-year, birth-month, birth-day.
// Returns { value: "YYYY" | "YYYY-MM" | "YYYY-MM-DD" | null } or { error: "message" }
export function readDate(prefix, label) {
    const year = $(prefix + "-year").value.trim();
    const month = $(prefix + "-month").value.trim();
    const day = $(prefix + "-day").value.trim();

    // Everything empty = unknown, so the field won't be saved
    if (year === "" && month === "" && day === "") return { value: null };

    // Any date needs a year, and a day needs a month
    if (year === "") return { error: label + ": enter a year." };
    if (day !== "" && month === "") return { error: label + ": enter a month as well as a day." };

    if (!/^\d{4}$/.test(year) || Number(year) === 0) {
        return { error: label + ": the year must have 4 digits." };
    }
    let result = year;

    if (month !== "") {
        if (!/^\d{1,2}$/.test(month) || Number(month) < 1 || Number(month) > 12) {
            return { error: label + ": the month must be between 1 and 12." };
        }
        result += "-" + month.padStart(2, "0"); // the rules need "05", not "5"
    }

    if (day !== "") {
        const maxDay = daysInMonth(Number(year), Number(month));
        if (!/^\d{1,2}$/.test(day) || Number(day) < 1 || Number(day) > maxDay) {
            return { error: label + ": that month has " + maxDay + " days." };
        }
        result += "-" + day.padStart(2, "0");
    }

    return { value: result };
}

// "1931-05" -> 1931 / 05 / empty in the three boxes
export function fillDate(prefix, value) {
    const [year, month, day] = (value ?? "").split("-");
    $(prefix + "-year").value = year ?? "";
    $(prefix + "-month").value = month ?? "";
    $(prefix + "-day").value = day ?? "";
}
