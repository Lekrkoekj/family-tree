import { db, myEmail } from "./firebase.js";
import {
    collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
    query, where, writeBatch, serverTimestamp
}
    from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { goBack, goTo } from "./router.js";
import { $, showError, friendlyError, displayName } from "./ui.js";

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
            const info = document.createElement("div");
            info.className = "info";

            const name = document.createElement("div");
            name.textContent = p.lastName + ", " + p.firstName; // textContent: never put user data in innerHTML

            const meta = document.createElement("div");
            meta.className = "muted";
            meta.textContent = lifespan(p);

            info.append(name, meta);

            const link = document.createElement("a");
            link.href = "#/person/edit/" + encodeURIComponent(p.id);
            link.append(info);

            const li = document.createElement("li");
            li.append(link);
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

let editingPersonId = null; // null = adding a new person

// "1931-05" -> 1931 / 05 / empty in the three boxes
function fillDate(prefix, value) {
    const [year, month, day] = (value ?? "").split("-");
    $(prefix + "-year").value = year ?? "";
    $(prefix + "-month").value = month ?? "";
    $(prefix + "-day").value = day ?? "";
}

// Used by both #/person/new (id = null) and #/person/edit/<id>
export async function renderPersonForm(id) {
    editingPersonId = id;

    $("person-form").reset();
    $("death-date").hidden = true;
    $("person-error").hidden = true;

    const submit = $("person-submit");
    const remove = $("person-delete");
    submit.textContent = id ? "Save" : "Add person";
    remove.hidden = !id;
    submit.disabled = remove.disabled = !!id; // when editing, wait until the person has loaded
    if (!id) return;

    try {
        const snap = await getDoc(doc(db, "persons", id));
        if (editingPersonId !== id) return;
        if (!snap.exists()) {
            goTo("#/people", { replace: true });
            return;
        }

        const p = snap.data();
        $("first-name").value = p.firstName;
        $("last-name").value = p.lastName;
        $("gender").value = p.gender;
        fillDate("birth", p.birthDate);
        $("deceased").checked = p.deceased === true;
        $("death-date").hidden = !p.deceased;
        fillDate("death", p.deathDate);
        submit.disabled = remove.disabled = false;
    } catch (error) {
        console.error("Could not load person:", error);
        showError($("person-error"), friendlyError(error));
    }
}

async function deletePerson() {
    const id = editingPersonId;
    const name = $("first-name").value.trim() + " " + $("last-name").value.trim();
    if (!confirm("Delete " + name + "? Their relationships are removed too. This can't be undone.")) return;

    const remove = $("person-delete");
    remove.disabled = true;
    try {
        const relations = collection(db, "relations");
        const [asA, asB] = await Promise.all([
            getDocs(query(relations, where("personA", "==", id))),
            getDocs(query(relations, where("personB", "==", id))),
        ]);

        // All or nothing: the person and every relation they are part of
        const batch = writeBatch(db);
        batch.delete(doc(db, "persons", id));
        [...asA.docs, ...asB.docs].forEach((d) => batch.delete(d.ref));
        await batch.commit();
        goBack();
    } catch (error) {
        console.error("Could not delete person:", error);
        showError($("person-error"), friendlyError(error));
        remove.disabled = false;
    }
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
        if (editingPersonId) await setDoc(doc(db, "persons", editingPersonId), person);
        else await addDoc(collection(db, "persons"), person);
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
        users.sort((a, b) =>
            (a.lastName ?? "").localeCompare(b.lastName ?? "") ||
            (a.firstName ?? "").localeCompare(b.firstName ?? ""));

        const requests = users.filter((u) => u.role === "pending");
        const members = users.filter((u) => u.role !== "pending");

        $("requests-header").textContent = "Requests (" + requests.length + ")";
        $("requests-list").replaceChildren(...requests.map(requestItem));
        $("requests-section").hidden = requests.length === 0;

        $("users-header").textContent = "Users (" + members.length + ")";
        $("users-list").replaceChildren(...members.map(userItem));
        $("users-section").hidden = false;

        status.hidden = true;
    } catch (error) {
        console.error("Could not load users:", error);
        showError(status, friendlyError(error));
    }
}

function userInfo(u) {
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.textContent = displayName(u);
    const meta = document.createElement("div");
    meta.className = "muted";
    meta.textContent = u.email + " · " + u.role;
    info.append(name, meta);
    return info;
}

function userItem(u) {
    const link = document.createElement("a");
    link.href = u.email === myEmail() ? "#/account/edit" : "#/user/" + encodeURIComponent(u.email);
    link.append(userInfo(u));

    const li = document.createElement("li");
    li.append(link);
    return li;
}

function requestItem(u) {
    const approve = document.createElement("button");
    approve.textContent = "Approve";
    const deny = document.createElement("button");
    deny.textContent = "Deny";
    deny.className = "danger";

    // Runs one of the two actions with both buttons disabled, then reloads the list
    async function act(action, label) {
        approve.disabled = deny.disabled = true;
        try {
            await action();
            await renderUsers();
        } catch (error) {
            console.error("Could not " + label + ":", error);
            showError($("users-status"), friendlyError(error));
            approve.disabled = deny.disabled = false;
        }
    }

    approve.onclick = () => act(() => updateDoc(doc(db, "users", u.email), { role: "viewer" }), "approve");
    deny.onclick = () => {
        if (!confirm("Deny the request from " + displayName(u) + "?")) return;
        act(() => deleteDoc(doc(db, "users", u.email)), "deny");
    };

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(approve, deny);

    const li = document.createElement("li");
    li.append(userInfo(u), actions);
    return li;
}

// ---------- Edit user ----------

let editingEmail = null;

export async function renderUserDetail(email) {
    // Your own account is edited on the Account screen, where the rules allow it
    if (email === myEmail()) {
        goTo("#/account/edit", { replace: true });
        return;
    }
    editingEmail = email;

    $("edit-user-form").reset();
    $("edit-user-error").hidden = true;
    $("edit-user-email").value = email;
    $("edit-user-submit").disabled = $("edit-user-remove").disabled = true;

    try {
        const snap = await getDoc(doc(db, "users", email));
        if (editingEmail !== email) return; // already opened someone else while this was loading

        // Deleted in the meantime, or still a request: nothing to edit here
        if (!snap.exists() || snap.data().role === "pending") {
            goTo("#/users", { replace: true });
            return;
        }

        const u = snap.data();
        $("edit-user-first-name").value = u.firstName ?? "";
        $("edit-user-last-name").value = u.lastName ?? "";
        $("edit-user-role").value = u.role;
        $("edit-user-submit").disabled = $("edit-user-remove").disabled = false;
    } catch (error) {
        console.error("Could not load user:", error);
        showError($("edit-user-error"), friendlyError(error));
    }
}

async function submitUserDetail(event) {
    event.preventDefault();
    const errorEl = $("edit-user-error");
    errorEl.hidden = true;

    const firstName = $("edit-user-first-name").value.trim();
    const lastName = $("edit-user-last-name").value.trim();
    const role = $("edit-user-role").value;

    if (firstName === "" || lastName === "") return showError(errorEl, "Please fill in a first and last name.");
    if (!["viewer", "admin"].includes(role)) return showError(errorEl, "Please choose a role.");

    const submit = $("edit-user-submit");
    submit.disabled = true;
    try {
        await updateDoc(doc(db, "users", editingEmail), { firstName, lastName, role });
        goBack();
    } catch (error) {
        console.error("Could not save user:", error);
        showError(errorEl, friendlyError(error));
        submit.disabled = false;
    }
}

async function removeUser() {
    const name = $("edit-user-first-name").value.trim() || editingEmail;
    if (!confirm("Remove " + name + "? They will lose access to the family tree.")) return;

    const remove = $("edit-user-remove");
    remove.disabled = true;
    try {
        await deleteDoc(doc(db, "users", editingEmail));
        goBack();
    } catch (error) {
        console.error("Could not remove user:", error);
        showError($("edit-user-error"), friendlyError(error));
        remove.disabled = false;
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
    $("person-delete").onclick = deletePerson;
    $("user-form").onsubmit = submitUser;
    $("edit-user-form").onsubmit = submitUserDetail;
    $("edit-user-remove").onclick = removeUser;
}