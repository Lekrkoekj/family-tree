import { goTo, goBack, setLeaveGuard } from "./router.js";
import { renderPersonForm, personFormSnapshot } from "./admin.js";
import { $, friendlyError } from "./ui.js";
import { formatDate, lifespan, age } from "./dates.js";
import { getPerson, getRelations, getHomePersonId, setHomePerson, getFile, getFiles } from "./store.js";
import { fullName } from "./names.js";
import { initRelations, openPicker, confirmRemove, openWedding } from "./relations.js";
import { fileSections, renderFileView, fileActions } from "./filesPage.js";
import { blobUrl } from "./storage.js";
import { icon, iconButton } from "./icons.js";

let isAdmin = false;
let editing = false; // true on #/person/<id>/edit: the left column shows the form instead of the details

// Same width as the two-column layout in viewer.css
const isDesktop = () => matchMedia("(min-width: 800px)").matches;

export function initPerson(options) {
    isAdmin = options.isAdmin;
    if (isAdmin) initRelations();
    $("person-tree-link").prepend(icon("tree"));
    $("person-set-home").prepend(icon("home"));

    // Desktop: the name appears in the left bar once the big name has scrolled out of view
    // (while editing the bar says "Edit person" instead)
    new IntersectionObserver(([entry]) => {
        if (!editing) $("person-bar-name").hidden = entry.isIntersecting;
    }, { root: $("person-left-scroll") }).observe($("person-name"));

    // Opening a file: on a phone that's a step back can undo (the file covers the whole screen);
    // on desktop it's just the right column changing, so back leaves the page instead
    for (const area of [$("person-files"), $("person-photo-link")]) {
        area.addEventListener("click", (event) => {
            const link = event.target.closest("a[href]");
            if (!link) return;
            event.preventDefault();
            goTo(link.getAttribute("href"), { replace: isDesktop() });
        });
    }
}

function personHash(id) {
    return "#/person/" + encodeURIComponent(id);
}

// The left column's bar (desktop) and the app's top bar (phone), in view or edit mode.
// Editing swaps the details below the photo for the person form; the photo stays.
function renderBars(p, edit) {
    editing = edit;
    $("person-view-part").hidden = edit;
    $("person-edit-area").hidden = !edit;

    if (edit) {
        renderPersonForm(p.id, $("person-edit-area"));
        // Leaving with × / back asks first, but only when something was changed
        const saved = personFormSnapshot();
        setLeaveGuard(() => personFormSnapshot() === saved || confirm("Discard your changes?"));

        const save = () => $("person-form").requestSubmit(); // the form's own checks and saving
        const saveButton = () => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "button";
            b.textContent = "Save";
            b.onclick = save;
            return b;
        };
        $("person-bar-left").replaceChildren(iconButton("close", "Cancel", () => goBack()));
        $("person-bar-name").textContent = "Edit person";
        $("person-bar-name").hidden = false;
        $("person-bar-right").replaceChildren(saveButton());
        $("title").textContent = "Edit person";
        $("top-actions").replaceChildren(saveButton());
        return;
    }

    // Back leaves the page (opening files never adds a step on desktop)
    const editPerson = () => goTo(personHash(p.id) + "/edit");
    $("person-bar-left").replaceChildren(iconButton("back", "Back", () => goBack({ fallback: "#/tree/" + encodeURIComponent(p.id) })));
    $("person-bar-name").textContent = fullName(p);
    $("person-bar-right").replaceChildren(...(isAdmin ? [iconButton("pencil", "Edit person", editPerson)] : []));
    // Phone: the app's top bar shows the name (or the open file, see renderFiles)
    $("title").textContent = fullName(p);
    $("top-actions").replaceChildren(...(isAdmin ? [iconButton("pencil", "Edit person", editPerson)] : []));
}

// Closes the open file: on a phone a step back (opening it was a step), on desktop a swap
function closeFile(id) {
    if (isDesktop()) goTo(personHash(id), { replace: true });
    else goBack({ fallback: personHash(id) });
}

// #/person/<id>, #/person/<id>/file/<fileId> with that file open in the right column,
// or #/person/<id>/edit with the edit form in the left column
export function renderPerson(id, fileId = null, edit = false) {
    const p = getPerson(id);
    if (!p) {
        goTo(isAdmin ? "#/people" : "#/tree", { replace: true });
        return;
    }

    // On desktop each column scrolls on its own: the files start at the top every time,
    // the person only when it's another person (so it stays put while you look through their files)
    $("person-files-scroll").scrollTop = $("person-file-scroll").scrollTop = 0;
    if ($("person-page").dataset.personId !== id) $("person-left-scroll").scrollTop = 0;
    $("person-page").dataset.personId = id;

    renderPhoto(p);
    $("person-name").textContent = fullName(p);
    $("person-bar-name").textContent = fullName(p);
    $("person-facts").replaceChildren(...facts(p));

    renderBars(p, edit && isAdmin);
    $("person-description").textContent = p.description ?? "";
    $("person-description").hidden = !p.description;

    const rerender = () => renderPerson(id, fileId);
    renderFiles(p, fileId, rerender);
    $("person-tree-link").href = "#/tree/" + encodeURIComponent(id);

    const isHome = getHomePersonId() === id;
    $("person-is-home").hidden = !isAdmin || !isHome; // only admins know what "home person" means
    $("person-set-home").hidden = !isAdmin || isHome;
    $("person-set-home").onclick = async () => {
        try {
            await setHomePerson(id);
            rerender();
        } catch (error) {
            console.error("Could not set home person:", error);
            alert(friendlyError(error));
        }
    };

    const relatives = findRelatives(id);
    fillRelatives("person-parents", relatives.parents, "Unknown", "parent", id, rerender);
    fillRelatives("person-partners", relatives.partners, "None", "partner", id, rerender);
    fillRelatives("person-children", relatives.children, "None", "child", id, rerender);

    // Nobody has more than two parents, so the button goes away at two
    document.querySelectorAll(".add-relative").forEach((button) => {
        const kind = button.dataset.kind;
        button.hidden = !isAdmin || (kind === "parent" && relatives.parents.length >= 2);
        button.onclick = () => openPicker(id, kind, rerender);
    });
}

// The profile photo above the name: the photo's display version, at the full width of the column.
// Clicking it opens that photo on the right.
let photoToken = null;
function renderPhoto(p) {
    const link = $("person-photo-link");
    const img = $("person-photo");
    const file = p.photo && getFile(p.photo.file);
    const version = file?.storage && (file.storage.display ?? file.storage.original);
    link.hidden = !version;
    if (!version) return;

    link.href = "#/person/" + encodeURIComponent(p.id) + "/file/" + encodeURIComponent(file.id);
    img.alt = fullName(p);
    const token = photoToken = {}; // ignore a slow download when another person is shown by then
    if (img.dataset.path !== version.path) img.removeAttribute("src");
    blobUrl(version.path).then((src) => {
        if (photoToken !== token) return;
        img.src = src;
        img.dataset.path = version.path;
    }).catch(() => { link.hidden = true; });
}

// The right column: all their files in sections per category, or the one file that's open
function renderFiles(p, fileId, rerender) {
    const open = fileId && getFile(fileId);
    if (fileId && !open) {
        goTo("#/person/" + encodeURIComponent(p.id), { replace: true }); // that file no longer exists
        return;
    }
    $("person-page").classList.toggle("file-open", !!open); // on a phone, an open file gets the whole screen
    $("person-files-overview").hidden = !!open;
    $("person-file-open").hidden = !open;

    if (open) {
        const options = {
            profileFor: p.id,
            onChange: rerender,                  // the profile photo on the left changes
            onDeleted: () => closeFile(p.id),    // back to all files, not away from the person
        };
        // Desktop: the file bar at the top of the right column
        $("file-bar-left").replaceChildren(iconButton("back", "All files", () => closeFile(p.id)));
        $("file-bar-title").textContent = open.title;
        $("file-bar-right").replaceChildren(...fileActions(open, options));
        // Phone: the app's top bar is the file bar (its back arrow undoes the step that opened the file)
        $("title").textContent = open.title;
        $("top-actions").replaceChildren(...fileActions(open, options));

        renderFileView($("person-file-view"), open);
        return;
    }

    const files = getFiles().filter((f) => f.people.includes(p.id));
    $("person-files-empty").hidden = files.length > 0;
    $("person-files").replaceChildren(...(files.length
        ? fileSections(files, (f) => "#/person/" + encodeURIComponent(p.id) + "/file/" + encodeURIComponent(f.id))
        : []));
    $("person-add-file").hidden = !isAdmin;
    $("person-add-file").href = "#/file/new/" + encodeURIComponent(p.id);
}

// "29 May 1943 in Bad Axe, Michigan", "1943", "Bad Axe, Michigan", or "Unknown"
function whenAndWhereText(date, place) {
    if (date && place) return formatDate(date) + " in " + place;
    return date ? formatDate(date) : place || "Unknown";
}

// The same, as pieces to append(), with a grey "in" so date and place read as two parts
function whenAndWhere(date, place) {
    if (!date || !place) return [whenAndWhereText(date, place)];
    const word = document.createElement("span");
    word.className = "unknown"; // the grey from the "(unknown)" style
    word.textContent = "in";
    return [formatDate(date) + " ", word, " " + place];
}

// The rows of the Born / Died / Buried list
function facts(p) {
    const rows = [];
    const ageText = age(p);

    const born = whenAndWhere(p.birthDate, p.birthPlace);
    if (ageText && !p.deceased) born.push(" (" + ageText + (ageText === "1" ? " year old)" : " years old)"));
    rows.push(["Born", born]);

    if (p.deceased) {
        const died = whenAndWhere(p.deathDate, p.deathPlace);
        if (ageText) died.push(" (aged " + ageText + ")");
        rows.push(["Died", died]);
        if (p.burialDate || p.burialPlace) rows.push(["Buried", whenAndWhere(p.burialDate, p.burialPlace)]);
    }

    return rows.flatMap(([label, pieces]) => {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.append(...pieces); // plain strings become text, never HTML
        return [dt, dd];
    });
}

// In parent-child, personA is the parent. Partners can be either side.
function findRelatives(id) {
    const result = { parents: [], partners: [], children: [] };

    for (const r of getRelations()) {
        let group, otherId;
        if (r.personA === id) [group, otherId] = [r.type === "partner" ? "partners" : "children", r.personB];
        else if (r.personB === id) [group, otherId] = [r.type === "partner" ? "partners" : "parents", r.personA];
        else continue;

        const other = getPerson(otherId);
        if (other) result[group].push({ ...other, relationId: r.id, weddingDate: r.weddingDate, weddingPlace: r.weddingPlace });
    }

    const byBirth = (a, b) => (a.birthDate ?? "9999").localeCompare(b.birthDate ?? "9999");
    result.parents.sort(byBirth);
    result.children.sort(byBirth);
    result.partners.sort((a, b) => (a.weddingDate ?? "9999").localeCompare(b.weddingDate ?? "9999"));
    return result;
}

function fillRelatives(listId, people, emptyText, kind, personId, rerender) {
    if (people.length === 0) {
        const li = document.createElement("li");
        li.className = "muted";
        li.textContent = emptyText;
        $(listId).replaceChildren(li);
        return;
    }

    $(listId).replaceChildren(...people.map((p) => {
        const name = document.createElement("div");
        name.textContent = fullName(p);
        const meta = document.createElement("div");
        meta.className = "muted";
        const married = p.weddingDate || p.weddingPlace ? "married " + whenAndWhereText(p.weddingDate, p.weddingPlace) : "";
        meta.textContent = [lifespan(p), married].filter(Boolean).join(" • ");

        const info = document.createElement("div");
        info.className = "info";
        info.append(name, meta);

        const link = document.createElement("a");
        link.href = "#/person/" + encodeURIComponent(p.id);
        link.append(info);

        const li = document.createElement("li");
        li.append(link);
        if (isAdmin) li.append(relativeActions(p, kind, personId, rerender));
        return li;
    }));
}

function relativeActions(p, kind, personId, rerender) {
    const actions = document.createElement("div");
    actions.className = "actions";

    if (kind === "partner") {
        const weddingButton = document.createElement("button");
        weddingButton.textContent = p.weddingDate || p.weddingPlace ? "Edit wedding" : "Add wedding";
        weddingButton.onclick = () => openWedding(p.relationId, rerender);
        actions.append(weddingButton);
    }

    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.className = "danger";
    remove.setAttribute("aria-label", "Remove " + kind);
    remove.onclick = () => confirmRemove(p.relationId, p.id, kind, personId, rerender);
    actions.append(remove);
    return actions;
}
