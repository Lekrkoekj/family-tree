// Admin → File categories: add, rename (inline) and delete the optional labels for files.

import { $, showError, friendlyError } from "./ui.js";
import { getCategories, getFiles, addCategory, renameCategory, deleteCategory } from "./store.js";

export function initCategories() {
    $("category-form").onsubmit = async (event) => {
        event.preventDefault();
        const input = $("category-name");
        if (await save(() => addCategory(input.value.trim()), input.value)) input.value = "";
    };
}

export function renderCategories() {
    $("category-error").hidden = true;
    const categories = getCategories();
    $("categories-status").hidden = categories.length > 0;
    $("categories-list").replaceChildren(...categories.map(row));
}

function row(c) {
    const count = getFiles().filter((f) => f.category === c.id).length;
    const name = document.createElement("div");
    name.textContent = c.name;
    const meta = document.createElement("div");
    meta.className = "muted";
    meta.textContent = count + (count === 1 ? " file" : " files");
    const info = document.createElement("div");
    info.className = "info";
    info.append(name, meta);

    const rename = button("Rename", () => startRename(li, c));
    const remove = button("Delete", () => removeCategory(c, count), "danger");
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(rename, remove);

    const li = document.createElement("li");
    li.append(info, actions);
    return li;
}

// Swaps the row for a text field with Save / Cancel
function startRename(li, c) {
    const input = document.createElement("input");
    input.value = c.name;
    input.maxLength = 50;
    const form = document.createElement("form");
    form.className = "inline-form";
    form.append(input, button("Save", null, "", "submit"), button("Cancel", renderCategories));
    form.onsubmit = async (event) => {
        event.preventDefault();
        await save(() => renameCategory(c.id, input.value.trim()), input.value, c.id);
    };
    li.replaceChildren(form);
    input.focus();
    input.select();
}

async function removeCategory(c, count) {
    const files = count === 0 ? "" : " Its " + count + (count === 1 ? " file becomes" : " files become") + " uncategorized; no files are deleted.";
    if (!confirm("Delete the category “" + c.name + "”?" + files)) return;
    await save(() => deleteCategory(c.id));
}

// Checks the name (if any), runs the change, shows errors, and redraws. Returns true when it worked.
async function save(action, name = null, ownId = null) {
    const errorEl = $("category-error");
    errorEl.hidden = true;
    if (name !== null) {
        const clean = name.trim();
        const taken = getCategories().find((c) => c.id !== ownId && c.name.toLowerCase() === clean.toLowerCase());
        const problem = !clean ? "Please type a name." : taken ? "There is already a category called “" + taken.name + "”." : null;
        if (problem) {
            showError(errorEl, problem);
            return false;
        }
    }
    try {
        await action();
        renderCategories();
        return true;
    } catch (error) {
        console.error("Could not save category:", error);
        showError(errorEl, friendlyError(error));
        return false;
    }
}

function button(text, onclick, className = "", type = "button") {
    const b = document.createElement("button");
    b.type = type;
    b.textContent = text;
    b.className = className;
    if (onclick) b.onclick = onclick;
    return b;
}
