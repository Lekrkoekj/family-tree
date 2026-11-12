// Works out what someone is to the selected person: "Grandfather", "1st cousin once removed", "Sister-in-law"...
// Pure calculation, like treeLayout.js.

import { buildGraph } from "./treeLayout.js";

// Returns a function: id -> label (empty for the selected person themselves, or if no relation is found)
export function relationshipLabeler(rootId, persons, relations) {
    const g = buildGraph(persons, relations);
    const genderOf = (id) => persons.get(id)?.gender;
    const parentsOf = (id) => g.parentsOf(id).filter(Boolean);

    // All ancestors of a person with how many generations up they are (the person themselves = 0).
    // Breadth-first, so when someone can be reached in two ways (cousins who married), the shortest wins.
    const ancestorCache = new Map();
    function ancestors(id) {
        if (ancestorCache.has(id)) return ancestorCache.get(id);
        const dist = new Map([[id, 0]]);
        let frontier = [id];
        for (let gen = 1; frontier.length > 0; gen++) {
            const next = [];
            for (const x of frontier) {
                for (const p of parentsOf(x)) {
                    if (!dist.has(p)) {
                        dist.set(p, gen);
                        next.push(p);
                    }
                }
            }
            frontier = next;
        }
        ancestorCache.set(id, dist);
        return dist;
    }

    // Closest shared ancestor of a and b: { up: steps up from a, down: steps down to b } or null
    function blood(a, b) {
        const fromA = ancestors(a);
        const fromB = ancestors(b);
        let best = null;
        for (const [ancestor, up] of fromA) {
            const down = fromB.get(ancestor);
            if (down !== undefined && (!best || up + down < best.up + best.down)) best = { up, down };
        }
        return best;
    }

    // Every way the two can be related, each with its number of steps; the shortest one wins.
    // So "stepmother" (father -> his wife: 2 steps) beats a distant blood link through a cousin
    // marriage, while a grandfather (2 steps up) stays a grandfather. On a tie, blood wins.
    return (id) => {
        if (id === rootId) return "";
        const options = [];
        const steps = (path) => path.up + path.down;

        const direct = blood(rootId, id);
        if (direct) options.push({ steps: steps(direct), text: () => describe(direct, genderOf(id), rootId, id) });

        const partners = g.partnersOf(rootId);
        if (partners.includes(id)) options.push({ steps: 1, text: () => word("spouse", genderOf(id)) });

        // Family of the selected person's partner
        for (const p of partners) {
            const path = p !== id && blood(p, id);
            if (path) options.push({ steps: steps(path) + 1, text: () => inLaw(path, genderOf(id)) });
        }

        // Partners of the selected person's relatives
        for (const q of g.partnersOf(id)) {
            const path = q !== rootId && blood(rootId, q);
            if (path) options.push({ steps: steps(path) + 1, text: () => partnerOfRelative(path, genderOf(q), genderOf(id)) });
        }

        if (options.length === 0) return "";
        const best = options.reduce((a, b) => (b.steps < a.steps ? b : a)); // keeps the earlier (blood) one on a tie
        return capitalize(best.text());
    };

    // What b is to a, given the steps to their closest shared ancestor
    function describe({ up, down }, gender, a, b) {
        if (down === 0) return generational("parent", up, gender);
        if (up === 0) return generational("child", down, gender);
        if (up === 1 && down === 1) return (isHalfSibling(a, b) ? "half-" : "") + word("sibling", gender);
        if (down === 1) return greats(up - 2) + word("uncle", gender);
        if (up === 1) return down === 2 ? word("nephew", gender) : greats(down - 3) + "grand" + word("nephew", gender);

        const degree = Math.min(up, down) - 1;
        const removed = Math.abs(up - down);
        return ordinal(degree) + " cousin" + (removed ? " " + times(removed) + " removed" : "");
    }

    // Siblings who share only one known parent, while the other parent is known and different
    function isHalfSibling(a, b) {
        const pa = parentsOf(a);
        const pb = parentsOf(b);
        const shared = pa.filter((p) => pb.includes(p)).length;
        return shared === 1 && (pa.length === 2 || pb.length === 2);
    }

    // Blood relatives of the selected person's partner
    function inLaw(path, gender) {
        if (path.up === 1 && path.down === 0) return word("parent", gender) + "-in-law";
        if (path.up === 1 && path.down === 1) return word("sibling", gender) + "-in-law";
        if (path.up === 0) return "step" + (path.down === 1 ? "" : "-") + generational("child", path.down, gender);
        return describe(path, gender) + "-in-law";
    }

    // Partners of the selected person's blood relatives (relativeGender = the relative, gender = their partner)
    function partnerOfRelative(path, relativeGender, gender) {
        if (path.up === 0 && path.down === 1) return word("child", gender) + "-in-law";
        if (path.up === 1 && path.down === 1) return word("sibling", gender) + "-in-law";
        if (path.down === 0) return "step" + (path.up === 1 ? "" : "-") + generational("parent", path.up, gender);
        if (path.down === 1) return describe(path, gender); // an aunt's husband is an uncle too
        return describe(path, relativeGender) + "'s " + word("spouse", gender);
    }
}

// ---------- Words ----------

const WORDS = {
    parent: ["father", "mother", "parent"],
    child: ["son", "daughter", "child"],
    sibling: ["brother", "sister", "sibling"],
    uncle: ["uncle", "aunt", "uncle/aunt"],
    nephew: ["nephew", "niece", "nephew/niece"],
    spouse: ["husband", "wife", "partner"],
};

function word(kind, gender) {
    const [male, female, other] = WORDS[kind];
    return gender === "male" ? male : gender === "female" ? female : other;
}

// parent: 1 father, 2 grandfather, 3 great-grandfather, 4 2nd great-grandfather...
function generational(kind, generations, gender) {
    if (generations === 1) return word(kind, gender);
    return greats(generations - 2) + "grand" + word(kind, gender);
}

// 0 -> "", 1 -> "great-", 2 -> "2nd great-", 3 -> "3rd great-"
function greats(n) {
    if (n <= 0) return "";
    return (n === 1 ? "" : ordinal(n) + " ") + "great-";
}

function ordinal(n) {
    const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
    return n + suffix;
}

function times(n) {
    return n === 1 ? "once" : n === 2 ? "twice" : n + " times";
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}
