let routes = {};
let isAdmin = false;
let started = false;
let current = null; // the route definition that is showing right now

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
export function goBack() {
    if (depth > 0) history.back();
    else goTo(current?.parent ?? "#/tree", { replace: true });
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
    // A screen that needs a parameter but didn't get one: go to its parent.
    if (def.param && param === null) {
        goTo(def.parent ?? "#/tree", { replace: true });
        return;
    }
    current = def;

    const screenId = "screen-" + (def.screen ?? key);
    document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== screenId));
    $("title").textContent = def.title;
    $("back-button").hidden = !def.parent;

    const addLink = $("add-button");
    addLink.hidden = !def.add;
    if (def.add) addLink.href = def.add;

    document.querySelectorAll("#bottom-bar a").forEach((a) => {
        a.classList.toggle("active", a.dataset.tab === def.tab);
    });

    $("view").scrollTop = 0;
    if (def.render) def.render(param);
}