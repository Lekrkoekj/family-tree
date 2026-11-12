import { goTo } from "./router.js";
import { $ } from "./ui.js";
import { formatDate, lifespan, age } from "./dates.js";
import { getPerson, getRelations } from "./store.js";
import { fullName } from "./names.js";

let isAdmin = false;

export function initPerson(options) {
    isAdmin = options.isAdmin;
}

export function renderPerson(id) {
    const p = getPerson(id);
    if (!p) {
        goTo(isAdmin ? "#/people" : "#/tree", { replace: true });
        return;
    }

    $("person-name").textContent = fullName(p);
    $("person-edit-link").hidden = !isAdmin;
    $("person-edit-link").href = "#/person/edit/" + encodeURIComponent(id);
    $("person-facts").replaceChildren(...facts(p));

    const relatives = findRelatives(id);
    fillRelatives("person-parents", relatives.parents, "Unknown");
    fillRelatives("person-partners", relatives.partners, "None");
    fillRelatives("person-children", relatives.children, "None");
}

// The rows of the Born / Died list
function facts(p) {
    const rows = [];
    const ageText = age(p);

    let born = p.birthDate ? formatDate(p.birthDate) : "Unknown";
    if (ageText && !p.deceased) born += " (" + ageText + (ageText === "1" ? " year old)" : " years old)");
    rows.push(["Born", born]);

    if (p.deceased) {
        let died = p.deathDate ? formatDate(p.deathDate) : "Unknown";
        if (ageText) died += " (aged " + ageText + ")";
        rows.push(["Died", died]);
    }

    return rows.flatMap(([label, value]) => {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
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
        if (other) result[group].push({ ...other, weddingDate: r.weddingDate });
    }

    const byBirth = (a, b) => (a.birthDate ?? "9999").localeCompare(b.birthDate ?? "9999");
    result.parents.sort(byBirth);
    result.children.sort(byBirth);
    result.partners.sort((a, b) => (a.weddingDate ?? "9999").localeCompare(b.weddingDate ?? "9999"));
    return result;
}

function fillRelatives(listId, people, emptyText) {
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
        meta.textContent = [lifespan(p), p.weddingDate ? "married " + formatDate(p.weddingDate) : ""]
            .filter(Boolean).join(" · ");

        const info = document.createElement("div");
        info.className = "info";
        info.append(name, meta);

        const link = document.createElement("a");
        link.href = "#/person/" + encodeURIComponent(p.id);
        link.append(info);

        const li = document.createElement("li");
        li.append(link);
        return li;
    }));
}
