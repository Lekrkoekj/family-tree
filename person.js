import { db } from "./firebase.js";
import { collection, doc, getDoc, getDocs, query, where }
    from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { goTo } from "./router.js";
import { $, showError, friendlyError } from "./ui.js";
import { formatDate, lifespan, age } from "./dates.js";

let isAdmin = false;
let showingId = null;

export function initPerson(options) {
    isAdmin = options.isAdmin;
}

export async function renderPerson(id) {
    showingId = id;
    const status = $("person-status");
    status.textContent = "Loading…";
    status.hidden = false;
    $("person-details").hidden = true;

    try {
        const [snap, relatives] = await Promise.all([
            getDoc(doc(db, "persons", id)),
            loadRelatives(id),
        ]);
        if (showingId !== id) return; // already opened someone else while this was loading

        if (!snap.exists()) {
            goTo(isAdmin ? "#/people" : "#/tree", { replace: true });
            return;
        }

        const p = snap.data();
        $("person-name").textContent = p.firstName + " " + p.lastName;
        $("person-edit-link").hidden = !isAdmin;
        $("person-edit-link").href = "#/person/edit/" + encodeURIComponent(id);
        $("person-facts").replaceChildren(...facts(p));

        fillRelatives("person-parents", relatives.parents, "Unknown");
        fillRelatives("person-partners", relatives.partners, "None");
        fillRelatives("person-children", relatives.children, "None");

        status.hidden = true;
        $("person-details").hidden = false;
    } catch (error) {
        console.error("Could not load person:", error);
        showError(status, friendlyError(error));
    }
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

// Finds every relation this person is in and loads the person on the other side
async function loadRelatives(id) {
    const relations = collection(db, "relations");
    const [asA, asB] = await Promise.all([
        getDocs(query(relations, where("personA", "==", id))),
        getDocs(query(relations, where("personB", "==", id))),
    ]);

    // In parent-child, personA is the parent. Partners can be either side.
    const links = [];
    asA.forEach((d) => {
        const r = d.data();
        links.push({ group: r.type === "partner" ? "partners" : "children", otherId: r.personB, weddingDate: r.weddingDate });
    });
    asB.forEach((d) => {
        const r = d.data();
        links.push({ group: r.type === "partner" ? "partners" : "parents", otherId: r.personA, weddingDate: r.weddingDate });
    });

    const others = await Promise.all(links.map((l) => getDoc(doc(db, "persons", l.otherId))));

    const result = { parents: [], partners: [], children: [] };
    links.forEach((l, i) => {
        if (!others[i].exists()) return;
        result[l.group].push({ id: l.otherId, weddingDate: l.weddingDate, ...others[i].data() });
    });

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
        name.textContent = p.firstName + " " + p.lastName;
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
