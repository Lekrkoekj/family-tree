import { auth, db, getUserData, myEmail } from "./firebase.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { goBack } from "./router.js";
import { $, showError, friendlyError, displayName } from "./ui.js";

export async function renderAccount() {
    $("account-email").textContent = myEmail();
    try {
        const data = await getUserData(auth.currentUser);
        $("account-name").textContent = displayName({ email: myEmail(), ...data });
    } catch (error) {
        console.error("Could not load account:", error);
    }
}

export async function renderAccountEdit() {
    $("account-form").reset();
    $("account-error").hidden = true;
    $("account-edit-email").value = myEmail();

    const submit = $("account-submit");
    submit.disabled = true;
    try {
        const data = await getUserData(auth.currentUser);
        $("account-first-name").value = data?.firstName ?? "";
        $("account-last-name").value = data?.lastName ?? "";
        submit.disabled = false;
    } catch (error) {
        console.error("Could not load account:", error);
        showError($("account-error"), friendlyError(error));
    }
}

async function submitAccount(event) {
    event.preventDefault();
    const errorEl = $("account-error");
    errorEl.hidden = true;

    const firstName = $("account-first-name").value.trim();
    const lastName = $("account-last-name").value.trim();
    if (firstName === "" || lastName === "") return showError(errorEl, "Please fill in a first and last name.");

    const submit = $("account-submit");
    submit.disabled = true;
    try {
        await updateDoc(doc(db, "users", myEmail()), { firstName, lastName });
        goBack();
    } catch (error) {
        console.error("Could not save name:", error);
        showError(errorEl, friendlyError(error));
        submit.disabled = false;
    }
}

export function initAccount() {
    $("account-form").onsubmit = submitAccount;
}
