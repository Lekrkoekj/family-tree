// Works out where every box and line goes in the tree around one person.
// Pure calculation: no HTML and no Firestore, so it can be tested with made-up data.
//
// Coordinates are pixels. The selected person's box has its top-left corner at (0, 0).
// Generation 1 up is at y = -ROW, 1 down at y = +ROW, and so on.

export const BOX_W = 220;
export const BOX_H = 76; // room for a 2-line name, the years, and later a relationship label
const H_GAP = 24;  // between boxes in a row
const V_GAP = 64;  // between rows
const ROW = BOX_H + V_GAP;
const UP = 3;      // generations of ancestors
const DOWN = 2;    // generations of descendants

// persons: Map id -> person, relations: array of relation objects.
// Returns { nodes: [{ id, x, y, selected?, duplicate? }], lines: [[[x, y], [x, y], ...], ...] }
export function layoutTree(rootId, persons, relations) {
    const g = buildGraph(persons, relations);
    const out = { nodes: [], lines: [] };

    layoutAncestors(g, rootId, out);
    layoutSiblings(g, rootId, out);
    addUnit(out, layoutUnit(g, rootId, DOWN, true), 0, 0);

    // Someone can appear twice, e.g. when cousins married and share grandparents
    const count = new Map();
    out.nodes.forEach((n) => count.set(n.id, (count.get(n.id) ?? 0) + 1));
    out.nodes.forEach((n) => {
        n.selected = n.id === rootId && n.x === 0 && n.y === 0;
        n.duplicate = count.get(n.id) > 1;
    });
    return out;
}

// ---------- Who is related to whom ----------

function buildGraph(persons, relations) {
    const parents = new Map();
    const children = new Map();
    const partners = new Map();
    const add = (map, key, value) => {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(value);
    };

    for (const r of relations) {
        if (!persons.has(r.personA) || !persons.has(r.personB)) continue;
        if (r.type === "parent-child") {
            add(children, r.personA, r.personB);
            add(parents, r.personB, r.personA);
        } else {
            add(partners, r.personA, { id: r.personB, weddingDate: r.weddingDate });
            add(partners, r.personB, { id: r.personA, weddingDate: r.weddingDate });
        }
    }

    const birth = (id) => persons.get(id).birthDate ?? "9999";
    return {
        // [father, mother]: men on the left, women on the right, otherwise as stored
        parentsOf(id) {
            const list = [...(parents.get(id) ?? [])];
            list.sort((a, b) => genderOrder(persons.get(a)) - genderOrder(persons.get(b)));
            return [list[0] ?? null, list[1] ?? null];
        },
        childrenOf: (id) => [...(children.get(id) ?? [])].sort((a, b) => birth(a).localeCompare(birth(b))),
        // By wedding date; without a date last, in the order they were stored
        partnersOf: (id) => [...(partners.get(id) ?? [])]
            .sort((a, b) => (a.weddingDate ?? "9999").localeCompare(b.weddingDate ?? "9999"))
            .map((p) => p.id),
    };
}

function genderOrder(p) {
    return p.gender === "male" ? 0 : p.gender === "female" ? 1 : 0.5;
}

// ---------- Ancestors: a fixed "pedigree" of slots ----------

// Generation g has 2^g slots. The slots of the deepest generation are one box wide, and every
// generation above is spread over the same total width, so each couple sits centred above their child.
function layoutAncestors(g, rootId, out) {
    const levels = [];
    let previous = [rootId];
    for (let gen = 1; gen <= UP; gen++) {
        const level = previous.flatMap((id) => (id ? g.parentsOf(id) : [null, null]));
        if (level.every((id) => !id)) break;
        levels.push(level);
        previous = level;
    }
    if (levels.length === 0) return;

    const totalWidth = 2 ** levels.length * (BOX_W + H_GAP);
    const slotCenter = (gen, j) => BOX_W / 2 - totalWidth / 2 + (j + 0.5) * totalWidth / 2 ** gen;

    levels.forEach((ids, i) => {
        const gen = i + 1;
        const y = -gen * ROW;
        const mid = y + BOX_H / 2;

        ids.forEach((id, j) => {
            if (id) out.nodes.push({ id, x: slotCenter(gen, j) - BOX_W / 2, y });
        });

        // Each pair of slots (2j, 2j+1) are the parents of slot j one generation down
        for (let j = 0; j < ids.length / 2; j++) {
            const [a, b] = [ids[2 * j], ids[2 * j + 1]];
            if (!a && !b) continue;
            const childX = slotCenter(gen - 1, j);
            // For the selected person's parents the line ends at the siblings' bar instead
            const end = gen === 1 ? -V_GAP / 2 : y + ROW;

            if (a && b) {
                out.lines.push([[slotCenter(gen, 2 * j) + BOX_W / 2, mid], [slotCenter(gen, 2 * j + 1) - BOX_W / 2, mid]]);
                out.lines.push([[childX, mid], [childX, end]]);
            } else {
                // One known parent: down from them, then sideways to above the child.
                // Turns close under the parent, so it stays above the lines to the selected person's partners.
                const px = slotCenter(gen, a ? 2 * j : 2 * j + 1);
                const turn = y + BOX_H + 8;
                out.lines.push([[px, y + BOX_H], [px, turn], [childX, turn], [childX, end]]);
            }
        }
    });
}

// ---------- Siblings: to the left of the selected person, oldest first ----------

function layoutSiblings(g, rootId, out) {
    const parents = g.parentsOf(rootId).filter(Boolean);
    if (parents.length === 0) return;

    // Children of either parent, so half-siblings are included too
    const siblings = [...new Set(parents.flatMap((p) => g.childrenOf(p)))].filter((id) => id !== rootId);
    const step = BOX_W + H_GAP;
    const centers = siblings.map((id, i) => {
        const x = -(siblings.length - i) * step;
        out.nodes.push({ id, x, y: 0 });
        return x + BOX_W / 2;
    });

    const barY = -V_GAP / 2;
    centers.push(BOX_W / 2);
    out.lines.push([[Math.min(...centers), barY], [BOX_W / 2, barY]]);
    centers.forEach((x) => out.lines.push([[x, barY], [x, 0]]));
}

// ---------- Descendants: a person, their partners, and their children below ----------

// Returns a "unit" laid out around the person at (0, 0): { nodes, lines, minX, maxX }.
// Children are grouped per partner. Each group hangs centred under its own drop line, and when
// groups need more room, the partners above are pushed apart so no lines cross.
function layoutUnit(g, id, levelsBelow, isRoot = false) {
    const unit = { nodes: [{ id, x: 0, y: 0 }], lines: [], minX: 0, maxX: BOX_W };
    const partners = levelsBelow >= 1 ? g.partnersOf(id) : [];
    const kids = levelsBelow >= 1 ? g.childrenOf(id) : [];

    // Group 0 = children whose other parent is unknown (or not a partner); then one group per partner
    const groups = [{ partner: null, kids: [] }, ...partners.map((p) => ({ partner: p, kids: [] }))];
    for (const child of kids) {
        const other = g.parentsOf(child).find((p) => p && p !== id);
        (groups.find((gr) => gr.partner && gr.partner === other) ?? groups[0]).kids.push(child);
    }

    const barY = BOX_H + V_GAP / 2;
    let rowRight = BOX_W;     // right edge of the last box in this row
    let nextFree = -Infinity; // where the next group of children may start

    groups.forEach((group, k) => {
        const childUnits = group.kids.map((c) => layoutUnit(g, c, levelsBelow - 1));
        const width = childUnits.reduce((sum, u) => sum + (u.maxX - u.minX), 0) + H_GAP * Math.max(0, childUnits.length - 1);

        // x of the line that drops down to this group's children
        let dropX = k === 0 ? BOX_W / 2 : rowRight + H_GAP / 2;
        if (childUnits.length > 0) dropX = Math.max(dropX, nextFree + width / 2);

        let dropFromY = BOX_H; // group 0 drops from the bottom of the person
        if (k > 0) {
            const px = dropX + H_GAP / 2;
            unit.nodes.push({ id: group.partner, x: px, y: 0 });
            rowRight = px + BOX_W;

            if (k === 1) {
                // First partner: a straight line between the two
                unit.lines.push([[BOX_W, BOX_H / 2], [px, BOX_H / 2]]);
                dropFromY = BOX_H / 2;
            } else {
                // Later partners: a line over the earlier partners, each one higher and starting further left.
                // The selected person has room up to just under the parents; a child must stay under
                // the bar that connects them to their siblings.
                const height = isRoot ? Math.min(16 + (k - 2) * 14, 52) : Math.min(12 + (k - 2) * 8, 28);
                const startX = BOX_W - 16 - (k - 2) * 12;
                unit.lines.push([[startX, 0], [startX, -height], [px + BOX_W / 2, -height], [px + BOX_W / 2, 0]]);
                dropFromY = -height;
            }
        }

        if (childUnits.length === 0) return;

        unit.lines.push([[dropX, dropFromY], [dropX, barY]]);
        let left = dropX - width / 2;
        const centers = childUnits.map((child) => {
            const offsetX = left - child.minX;
            addUnit(unit, child, offsetX, ROW);
            left += child.maxX - child.minX + H_GAP;
            return offsetX + BOX_W / 2;
        });
        unit.lines.push([[Math.min(dropX, centers[0]), barY], [Math.max(dropX, centers.at(-1)), barY]]);
        centers.forEach((x) => unit.lines.push([[x, barY], [x, ROW]]));

        nextFree = dropX + width / 2 + H_GAP;
        unit.minX = Math.min(unit.minX, dropX - width / 2);
        unit.maxX = Math.max(unit.maxX, dropX + width / 2);
    });

    unit.maxX = Math.max(unit.maxX, rowRight);
    return unit;
}

// Copies a unit's boxes and lines into `target`, shifted by (dx, dy)
function addUnit(target, unit, dx, dy) {
    unit.nodes.forEach((n) => target.nodes.push({ ...n, x: n.x + dx, y: n.y + dy }));
    unit.lines.forEach((line) => target.lines.push(line.map(([x, y]) => [x + dx, y + dy])));
}
