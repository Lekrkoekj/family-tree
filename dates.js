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
