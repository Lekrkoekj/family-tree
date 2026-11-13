let routes = {};
let isAdmin = false;
let started = false;
let currentParent = null; // where the back button goes when there is no history to go back to

let depth = 0; // how many steps deep the user is inside the app (0 = the page we started on)
let replacing = false; // true while replacing the current history entry instead of adding one
let leaveGuard = null; // see setLeaveGuard
let tabTitle = null;   // see setTabTitle

const $ = (id) => document.getElementById(id);
const SITE_NAME = "Family Tree";

export function startRouter(options) {
    if (started) return;
    started = true;
    routes = options.routes;
    isAdmin = options.isAdmin;

    // The browser tab follows the top bar's title, whoever changes it
    new MutationObserver(updateTabTitle).observe($("title"), { childList: true, characterData: true, subtree: true });

    // After a refresh the browser keeps history.state, so we pick up where we were.
    depth = history.state?.depth ?? 0;
    history.replaceState({ depth }, "");

    window.addEventListener("hashchange", onHashChange);
    route();
}

/**
 * A screen can ask to be asked before it's left, e.g. a form with unsaved changes:
 * setLeaveGuard(() => confirm("Discard your changes?")). goTo and goBack then only go when it returns true.
 * Every new screen starts without one. (Plain links and the browser's own back button don't ask.)
 */
export function setLeaveGuard(fn) {
    leaveGuard = fn;
}

/**
 * The browser tab's title is "<what the top bar says> • Family Tree". A screen can name something else
 * instead, e.g. the person on the details page (whose top bar may show a file, or nothing).
 * Every new screen starts without one.
 */
export function setTabTitle(text) {
    tabTitle = text;
    updateTabTitle();
}

function updateTabTitle() {
    const page = (tabTitle ?? $("title").textContent).trim();
    document.title = page && page !== SITE_NAME ? page + " • " + SITE_NAME : SITE_NAME;
}

function mayLeave() {
    if (leaveGuard && !leaveGuard()) return false;
    leaveGuard = null;
    return true;
}

/** Go to a screen, e.g. goTo("#/people"). With replace: true the current history entry is overwritten. */
export function goTo(hash, { replace = false } = {}) {
    if (!mayLeave()) return;
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
    if (!mayLeave()) return;
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

// "#/person/new"                -> { key: "person-new", params: [] }
// "#/user/a%40b.com"            -> { key: "user", params: ["a@b.com"] }, if the "user" route has param: true/"optional"
// "#/person/abc/file/xyz"       -> { key: "person-file", params: ["abc", "xyz"] }, via pattern: "person/:id/file/:fileId"
function parseHash() {
    const path = location.hash.slice(2);
    const decode = (text) => {
        try {
            return decodeURIComponent(text);
        } catch {
            return null; // malformed %-encoding
        }
    };

    // Routes with a pattern: every ":name" part becomes a parameter, the other parts must match exactly
    const parts = path.split("/");
    for (const [key, def] of Object.entries(routes)) {
        if (!def.pattern) continue;
        const pattern = def.pattern.split("/");
        if (pattern.length !== parts.length) continue;
        const params = [];
        const fits = pattern.every((p, i) => {
            if (!p.startsWith(":")) return p === parts[i];
            params.push(decode(parts[i]));
            return params.at(-1); // an empty or broken parameter doesn't fit
        });
        if (fits) return { key, params };
    }

    const key = path.replace(/\//g, "-") || "tree";
    if (routes[key]) return { key, params: [] };

    const slash = path.lastIndexOf("/");
    const baseKey = path.slice(0, slash).replace(/\//g, "-");
    const param = decode(path.slice(slash + 1));
    if (slash <= 0 || !routes[baseKey]?.param) return { key, params: [] };
    return { key: baseKey, params: param ? [param] : [] };
}

function route() {
    leaveGuard = null; // the address already changed; the new screen may set its own guard in render
    tabTitle = null;   // and its own tab title
    const { key, params } = parseHash();
    const def = routes[key];

    // Unknown screen, or an admin screen for someone who isn't an admin: go to the tree.
    if (!def || (def.admin && !isAdmin)) {
        goTo("#/tree", { replace: true });
        return;
    }
    // parent can be a fixed hash or a function of the parameters, e.g. (id) => "#/person/" + id
    const parent = typeof def.parent !== "function" ? def.parent
        : params.length > 0 ? def.parent(...params) : null;

    // param: true = required, param: "optional" = may be left out.
    // A screen that needs a parameter but didn't get one: go to its parent.
    if (def.param === true && params.length === 0) {
        goTo(parent ?? "#/tree", { replace: true });
        return;
    }
    currentParent = parent;

    const screenId = "screen-" + (def.screen ?? key);
    document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== screenId));
    document.body.dataset.screen = screenId; // lets CSS style per screen (e.g. no top bar on the details page on desktop)
    $("title").textContent = def.title;      // a screen may replace this with something specific (a name)
    $("top-actions").replaceChildren();      // and may put its own buttons here
    $("back-button").hidden = !parent;
    // backLabel: text next to the arrow, where it helps to say where back goes ("All files")
    $("back-label").textContent = def.backLabel ?? "";
    $("back-button").classList.toggle("labelled", !!def.backLabel);
    $("back-button").setAttribute("aria-label", def.backLabel ?? "Back");

    const addLink = $("add-button");
    addLink.hidden = !def.add;
    if (def.add) addLink.href = def.add;

    document.querySelectorAll("#bottom-bar a").forEach((a) => {
        a.classList.toggle("active", a.dataset.tab === def.tab);
    });

    $("view").scrollTop = 0;
    if (def.render) def.render(...(params.length > 0 ? params : [null])); // render(null) = "no parameter", as before
}