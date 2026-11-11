import { db } from "./firebase.js";
import { collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, serverTimestamp }
    from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { goBack } from "./router.js";

const $ = (id) => document.getElementById(id);

function showError(el, message) {
    el.textContent = message;
    el.hidden = false;
}

// Firestore errors have a .code; "permission-denied" means the Security Rules said no.
function friendlyError(error) {
    if (error?.code === "permission-denied") return "You are not allowed to do that (the Security Rules said no).";
    return "Something went wrong. Check the console for details.";
}

// ---------- Date helpers ----------

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// Reads the three inputs, e.g. "birth" -> birth-year, birth-month, birth-day.
// Returns { value: "YYYY" | "YYYY-MM" | "YYYY-MM-DD" | null } or { error: "message" }
function readDate(prefix, label) {
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
        let maxDay = DAYS_IN_MONTH[Number(month) - 1];
        if (Number(month) === 2 && isLeapYear(Number(year))) maxDay = 29;

        if (!/^\d{1,2}$/.test(day) || Number(day) < 1 || Number(day) > maxDay) {
            return { error: label + ": that month has " + maxDay + " days." };
        }
        result += "-" + day.padStart(2, "0");
    }

    return { value: result };
}

// ---------- People ----------

// Format: "1931 – 2005", "b. 1931", or "" when nothing is known
function lifespan(p) {
    const birthYear = p.birthDate ? p.birthDate.slice(0, 4) : "?";
    if (p.deceased) {
        const deathYear = p.deathDate ? p.deathDate.slice(0, 4) : "?";
        return birthYear + " – " + deathYear;
    }
    return p.birthDate ? "b. " + birthYear : "";
}

export async function renderPeople() {
    const status = $("people-status");
    status.textContent = "Loading…";
    status.hidden = false;

    try {
        const snap = await getDocs(collection(db, "persons"));
        const people = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        people.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));

        const items = people.map((p) => {
            const li = document.createElement("li");
            const info = document.createElement("div");
            info.className = "info";

            const name = document.createElement("div");
            name.textContent = p.lastName + ", " + p.firstName; // textContent: never put user data in innerHTML

            const meta = document.createElement("div");
            meta.className = "muted";
            meta.textContent = lifespan(p);

            info.append(name, meta);
            li.append(info);
            return li;
        });

        // replaceChildren (instead of appending) means two overlapping renders can't create duplicates
        $("people-list").replaceChildren(...items);
        status.textContent = "No people yet. Use the + button to add the first one.";
        status.hidden = people.length > 0;
    } catch (error) {
        console.error("Could not load people:", error);
        showError(status, friendlyError(error));
    }
}

export function resetPersonForm() {
    $("person-form").reset();
    $("death-date").hidden = true;
    $("person-error").hidden = true;
    $("person-submit").disabled = false;
}

async function submitPerson(event) {
    event.preventDefault(); // otherwise the browser reloads the page
    const errorEl = $("person-error");
    errorEl.hidden = true;

    const firstName = $("first-name").value.trim();
    const lastName = $("last-name").value.trim();
    const gender = $("gender").value;

    if (firstName === "" || lastName === "") return showError(errorEl, "Please fill in a first and last name.");
    if (!["male", "female", "other"].includes(gender)) return showError(errorEl, "Please choose a gender.");

    // Firestore throws on undefined and the rules reject empty strings,
    // so optional fields are only added when they are filled in.
    const person = { firstName, lastName, gender };

    const birth = readDate("birth", "Birth date");
    if (birth.error) return showError(errorEl, birth.error);
    if (birth.value) person.birthDate = birth.value;

    if ($("deceased").checked) {
        person.deceased = true;
        // Only read the death fields when "Deceased" is ticked. Old values may still sit in the inputs.
        const death = readDate("death", "Death date");
        if (death.error) return showError(errorEl, death.error);
        if (death.value) person.deathDate = death.value;
    }

    // Compare years only; both are 4-digit strings so a text comparison works
    if (person.birthDate && person.deathDate && person.deathDate.slice(0, 4) < person.birthDate.slice(0, 4)) {
        return showError(errorEl, "The death date can't be before the birth date.");
    }

    const submit = $("person-submit");
    submit.disabled = true; // no double submits
    try {
        await addDoc(collection(db, "persons"), person);
        goBack(); // back to the list, which reloads itself
    } catch (error) {
        console.error("Could not save person:", error);
        showError(errorEl, friendlyError(error));
        submit.disabled = false;
    }
}

// ---------- Users ----------

export async function renderUsers() {
    const status = $("users-status");
    status.textContent = "Loading…";
    status.hidden = false;

    try {
        const snap = await getDocs(collection(db, "users"));
        const users = snap.docs.map((d) => ({ email: d.id, ...d.data() }));

        // Pending requests first, so they are the first thing you see
        const order = { pending: 0, admin: 1, viewer: 2 };
        users.sort((a, b) =>
            (order[a.role] ?? 3) - (order[b.role] ?? 3) ||
            (a.lastName ?? "").localeCompare(b.lastName ?? ""));

        const items = users.map((u) => {
            const li = document.createElement("li");

            const info = document.createElement("div");
            info.className = "info";
            const name = document.createElement("div");
            name.textContent = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
            const meta = document.createElement("div");
            meta.className = "muted";
            meta.textContent = u.email + " · " + u.role;
            info.append(name, meta);
            li.append(info);

            if (u.role === "pending") {
                const actions = document.createElement("div");
                actions.className = "actions";
                const approve = document.createElement("button");
                approve.textContent = "Approve";
                approve.onclick = async () => {
                    approve.disabled = true;
                    try {
                        await updateDoc(doc(db, "users", u.email), { role: "viewer" });
                        await renderUsers();
                    } catch (error) {
                        console.error("Could not approve:", error);
                        showError(status, friendlyError(error));
                        approve.disabled = false;
                    }
                };
                actions.append(approve);
                li.append(actions);
            }
            return li;
        });

        $("users-list").replaceChildren(...items);
        status.textContent = "No users yet.";
        status.hidden = users.length > 0;
    } catch (error) {
        console.error("Could not load users:", error);
        showError(status, friendlyError(error));
    }
}

export function resetUserForm() {
    $("user-form").reset();
    $("user-error").hidden = true;
    $("user-submit").disabled = false;
}

async function submitUser(event) {
    event.preventDefault();
    const errorEl = $("user-error");
    errorEl.hidden = true;

    // The document ID is the email in lowercase; the rules compare it with the email Google reports
    const email = $("user-email").value.trim().toLowerCase();
    const firstName = $("user-first-name").value.trim();
    const lastName = $("user-last-name").value.trim();
    const role = $("user-role").value;

    if (email === "" || firstName === "" || lastName === "") return showError(errorEl, "Please fill in every field.");
    if (!["viewer", "admin"].includes(role)) return showError(errorEl, "Please choose a role.");

    const submit = $("user-submit");
    submit.disabled = true;
    try {
        const ref = doc(db, "users", email);

        // setDoc on an existing document would overwrite it, so check first
        const existing = await getDoc(ref);
        if (existing.exists()) {
            showError(errorEl, email + " is already in the list (" + existing.data().role + "). Change their role from the Users list.");
            submit.disabled = false;
            return;
        }

        await setDoc(ref, { role, firstName, lastName, createdAt: serverTimestamp() });
        goBack();
    } catch (error) {
        console.error("Could not add user:", error);
        showError(errorEl, friendlyError(error));
        submit.disabled = false;
    }
}

// ---------- Setup ----------

// Called once for admins. Uses onsubmit = (not addEventListener) so calling it twice can't stack handlers.
export function initAdmin() {
    $("deceased").onchange = () => { $("death-date").hidden = !$("deceased").checked; };
    $("person-form").onsubmit = submitPerson;
    $("user-form").onsubmit = submitUser;
}