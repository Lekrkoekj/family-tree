let routes = {};
let isAdmin = false;
let started = false;
let currentParent = null; // where the back button goes when there is no history to go back to

let depth = 0; // how many steps deep the user is inside the app (0 = the page we started on)
let replacing = false; // true while replacing the current history entry instead of adding one

const $ = (id) => document.getElementById(id);

export function startRouter(options) {
    if (started) return;
    started = true;
    routes = options.routes;
    isAdmin = options.isAdmin;

    // After a refresh the browser keeps history.state, so we pick up where we were.
    depth = history.state?.depth ?? 0;
    history.replaceState({ depth }, "");

    window.addEventListener("hashchange", onHashChange);
    route();
}

/** Go to a screen, e.g. goTo("#/people"). With replace: true the current history entry is overwritten. */
export function goTo(hash, { replace = false } = {}) {
    if (location.hash === hash) {
        route(); // same hash = no hashchange event, so show it ourselves
        return;
    }
    replacing = replace;
    if (replace) location.replace(hash);
    else location.hash = hash;
}

/**
 * The back button. history.back() returns to wherever the user came from (a person screen can be
 * reached from the tree and from the admin list). But if the user opened this screen directly
 * (depth 0), history.back() would leave the app, so we go to the screen's fixed parent instead.
 */
export function goBack({ steps = 1, fallback = currentParent } = {}) {
    const possible = Math.min(steps, depth); // never step back out of the app
    if (possible > 0) history.go(-possible);
    else goTo(fallback ?? "#/tree", { replace: true });
}

function onHashChange() {
    if (replacing) {
        // We replaced the entry: same place in the history, new URL.
        replacing = false;
        history.replaceState({ depth }, "");
    } else if (history.state?.depth === undefined) {
        // A brand new history entry (a link was clicked or location.hash was set): one step deeper.
        depth += 1;
        history.replaceState({ depth }, "");
    } else {
        // The user pressed back/forward to an entry we have seen before; it remembers its own depth.
        depth = history.state.depth;
    }
    route();
}

// "#/person/new" -> { key: "person-new", param: null }
// "#/user/a%40b.com" -> { key: "user", param: "a@b.com" }, but only if the "user" route has param: true
function parseHash() {
    const path = location.hash.slice(2);
    const key = path.replace(/\//g, "-") || "tree";
    if (routes[key]) return { key, param: null };

    const slash = path.lastIndexOf("/");
    if (slash <= 0) return { key, param: null };

    const baseKey = path.slice(0, slash).replace(/\//g, "-");
    if (!routes[baseKey]?.param) return { key, param: null };

    try {
        return { key: baseKey, param: decodeURIComponent(path.slice(slash + 1)) || null };
    } catch {
        return { key: baseKey, param: null }; // malformed %-encoding
    }
}

function route() {
    const { key, param } = parseHash();
    const def = routes[key];

    // Unknown screen, or an admin screen for someone who isn't an admin: go to the tree.
    if (!def || (def.admin && !isAdmin)) {
        goTo("#/tree", { replace: true });
        return;
    }
    // parent can be a fixed hash or a function of the parameter, e.g. (id) => "#/person/" + id
    const parent = typeof def.parent !== "function" ? def.parent
        : param !== null ? def.parent(param) : null;

    // param: true = required, param: "optional" = may be left out.
    // A screen that needs a parameter but didn't get one: go to its parent.
    if (def.param === true && param === null) {
        goTo(parent ?? "#/tree", { replace: true });
        return;
    }
    currentParent = parent;

    const screenId = "screen-" + (def.screen ?? key);
    document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== screenId));
    $("title").textContent = def.title;
    $("back-button").hidden = !parent;

    const addLink = $("add-button");
    addLink.hidden = !def.add;
    if (def.add) addLink.href = def.add;

    document.querySelectorAll("#bottom-bar a").forEach((a) => {
        a.classList.toggle("active", a.dataset.tab === def.tab);
    });

    $("view").scrollTop = 0;
    if (def.render) def.render(param);
}