import { db, myEmail } from "./firebase.js";
import { collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, serverTimestamp }
    from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { goBack, goTo, setLeaveGuard } from "./router.js";
import { $, showError, friendlyError, displayName } from "./ui.js";
import { lifespan, readDate, fillDate } from "./dates.js";
import { getPerson, getPersons, savePerson, deletePerson } from "./store.js";
import { fullName, listName, compareByName } from "./names.js";

// ---------- People ----------

export function renderPeople() {
    const people = getPersons().sort(compareByName);

    const items = people.map((p) => {
        const name = document.createElement("div");
        name.append(...listName(p));
        const meta = document.createElement("div");
        meta.className = "muted";
        meta.textContent = lifespan(p);

        const info = document.createElement("div");
        info.className = "info";
        info.append(name, meta);

        const link = document.createElement("a");
        link.href = "#/person/" + encodeURIComponent(p.id);
        link.append(info);

        const li = document.createElement("li");
        li.append(link);
        return li;
    });

    $("people-list").replaceChildren(...items);
    const status = $("people-status");
    status.textContent = "No people yet. Use the + button to add the first one.";
    status.hidden = people.length > 0;
}

let editingPersonId = null; // null = adding a new person

// #/person/new (id = null) shows the form on its own screen. Editing (#/person/<id>/edit) puts the same
// form inside the details page: `container` is where it goes. There is only one form; append() moves it.
export function renderPersonForm(id, container = null) {
    const form = $("person-form");
    (container ?? $("screen-person-form")).append(form);
    form.classList.toggle("inline", !!container); // inline: Save is in the bar above it
    form.reset();
    $("death-fields").hidden = true;
    $("person-error").hidden = true;

    const p = id ? getPerson(id) : null;
    if (id && !p) {
        goTo("#/people", { replace: true });
        return;
    }
    editingPersonId = id;

    const submit = $("person-submit");
    const remove = $("person-delete");
    submit.textContent = id ? "Save" : "Add person";
    remove.hidden = !id;
    submit.disabled = remove.disabled = false;
    if (!p) return;

    $("given-names").value = p.givenNames ?? "";
    $("surname").value = p.surname ?? "";
    $("nickname").value = p.nickname ?? "";
    $("person-description-input").value = p.description ?? "";
    $("gender").value = p.gender;
    fillDate("birth", p.birthDate);
    $("birth-place").value = p.birthPlace ?? "";
    $("deceased").checked = p.deceased === true;
    $("death-fields").hidden = !p.deceased;
    fillDate("death", p.deathDate);
    $("death-place").value = p.deathPlace ?? "";
    fillDate("burial", p.burialDate);
    $("burial-place").value = p.burialPlace ?? "";
}

// Everything that's filled in, as one string: comparing two of these tells whether anything changed
export function personFormSnapshot() {
    return [...$("person-form").elements].map((el) => (el.type === "checkbox" ? el.checked : el.value)).join("\u0001");
}

async function removePerson() {
    const id = editingPersonId;
    if (!confirm("Delete " + fullName(getPerson(id)) + "? Their relationships are removed too. This can't be undone.")) return;

    const remove = $("person-delete");
    remove.disabled = true;
    try {
        await deletePerson(id);
        // Skip both this edit screen and the deleted person's details page
        setLeaveGuard(null);
        goBack({ steps: 2, fallback: "#/people" });
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

    const givenNames = $("given-names").value.trim();
    const surname = $("surname").value.trim();
    const nickname = $("nickname").value.trim();
    const gender = $("gender").value;

    if (givenNames === "" && surname === "") return showError(errorEl, "Please fill in a given name or a surname.");
    if (!["male", "female", "other"].includes(gender)) return showError(errorEl, "Please choose a gender.");

    // Firestore throws on undefined and the rules reject empty strings,
    // so optional fields are only added when they are filled in.
    const person = { gender };
    if (givenNames) person.givenNames = givenNames;
    if (surname) person.surname = surname;
    if (nickname) person.nickname = nickname;
    const description = $("person-description-input").value.trim();
    if (description) person.description = description;
    // The profile photo isn't on this form; keep it, because saving replaces the whole document
    const photo = editingPersonId && getPerson(editingPersonId)?.photo;
    if (photo) person.photo = photo;

    const birth = readDate("birth", "Birth date");
    if (birth.error) return showError(errorEl, birth.error);
    if (birth.value) person.birthDate = birth.value;
    const birthPlace = $("birth-place").value.trim();
    if (birthPlace) person.birthPlace = birthPlace;

    if ($("deceased").checked) {
        person.deceased = true;
        // Only read these when "Deceased" is ticked. Old values may still sit in the inputs.
        const death = readDate("death", "Death date");
        if (death.error) return showError(errorEl, death.error);
        if (death.value) person.deathDate = death.value;
        const burial = readDate("burial", "Burial date");
        if (burial.error) return showError(errorEl, burial.error);
        if (burial.value) person.burialDate = burial.value;
        for (const [field, inputId] of [["deathPlace", "death-place"], ["burialPlace", "burial-place"]]) {
            const value = $(inputId).value.trim();
            if (value) person[field] = value;
        }
    }

    // Compare years only; they are 4-digit strings so a text comparison works
    const year = (date) => date?.slice(0, 4);
    if (person.deathDate && person.birthDate && year(person.deathDate) < year(person.birthDate)) {
        return showError(errorEl, "The death date can't be before the birth date.");
    }
    if (person.burialDate && person.deathDate && year(person.burialDate) < year(person.deathDate)) {
        return showError(errorEl, "The burial date can't be before the death date.");
    }

    const submit = $("person-submit");
    submit.disabled = true; // no double submits
    try {
        if (editingPersonId) {
            await savePerson(editingPersonId, person);
            setLeaveGuard(null); // saved, so nothing to discard
            goBack();
        } else {
            // Replace, so going back from the new person skips the filled-in form
            const id = await savePerson(null, person);
            goTo("#/person/" + id, { replace: true });
        }
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
    $("deceased").onchange = () => { $("death-fields").hidden = !$("deceased").checked; };
    $("person-form").onsubmit = submitPerson;
    $("person-delete").onclick = removePerson;
    $("user-form").onsubmit = submitUser;
    $("edit-user-form").onsubmit = submitUserDetail;
    $("edit-user-remove").onclick = removeUser;
}