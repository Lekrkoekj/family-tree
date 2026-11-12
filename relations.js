// Admin tools on the person details page: adding/removing relatives and the wedding date and place.

import { $, showError, friendlyError } from "./ui.js";
import { readDate, fillDate } from "./dates.js";
import {
    getPerson, getRelations, makeRelation,
    addRelation, addPersonWithRelation, removeRelation, setWedding
} from "./store.js";
import { fullName } from "./names.js";
import { openPicker as openPersonPicker } from "./picker.js";

let wedding = null; // { relationId, onDone } while the wedding dialog is open

export function initRelations() {
    $("wedding-form").onsubmit = submitWedding;
    $("wedding-cancel").onclick = () => $("wedding-dialog").close();
}

// ---------- Picker ----------

// kind = "parent" | "partner" | "child", seen from personId. onDone runs after a successful save.
export function openPicker(personId, kind, onDone) {
    const name = fullName(getPerson(personId));
    openPersonPicker({
        title: "Add " + kind + " of " + name,
        newPersonTitle: "Add new person as a " + kind + " of " + name,
        exclude: excludedIds(personId),
        onPick: async (choice) => {
            if (choice.id) await addRelation(makeRelation(personId, kind, choice.id));
            else await addPersonWithRelation(choice.newPerson, personId, kind);
            onDone();
        },
    });
}

// The person themselves and everyone already directly related to them
function excludedIds(personId) {
    const ids = new Set([personId]);
    for (const r of getRelations()) {
        if (r.personA === personId) ids.add(r.personB);
        if (r.personB === personId) ids.add(r.personA);
    }
    return ids;
}

// ---------- Removing ----------

// "Remove Piet Keim as parent of Jan Keim?"
export async function confirmRemove(relationId, otherId, kind, personId, onDone) {
    const question = "Remove " + fullName(getPerson(otherId)) + " as " + kind + " of " + fullName(getPerson(personId))
        + "? Both people are kept.";
    if (!confirm(question)) return;

    try {
        await removeRelation(relationId);
        onDone();
    } catch (error) {
        console.error("Could not remove relation:", error);
        alert(friendlyError(error));
    }
}

// ---------- Wedding date and place ----------

export function openWedding(relationId, onDone) {
    wedding = { relationId, onDone };
    const r = getRelations().find((x) => x.id === relationId);
    $("wedding-title").textContent = fullName(getPerson(r.personA)) + " & " + fullName(getPerson(r.personB));
    fillDate("wedding", r.weddingDate);
    $("wedding-place").value = r.weddingPlace ?? "";
    $("wedding-error").hidden = true;
    $("wedding-submit").disabled = false;
    $("wedding-dialog").showModal();
}

async function submitWedding(event) {
    event.preventDefault();
    const date = readDate("wedding", "Wedding date");
    if (date.error) return showError($("wedding-error"), date.error);

    $("wedding-submit").disabled = true;
    try {
        await setWedding(wedding.relationId, date.value, $("wedding-place").value.trim() || null);
        $("wedding-dialog").close();
        wedding.onDone();
    } catch (error) {
        console.error("Could not save wedding date:", error);
        showError($("wedding-error"), friendlyError(error));
        $("wedding-submit").disabled = false;
    }
}
