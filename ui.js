export const $ = (id) => document.getElementById(id);

export function showError(el, message) {
    el.textContent = message;
    el.hidden = false;
}

// Firestore errors have a .code; "permission-denied" means the Security Rules said no.
export function friendlyError(error) {
    if (error?.code === "permission-denied") return "You are not allowed to do that (the Security Rules said no).";
    return "Something went wrong. Check the console for details.";
}

// "Jan Keim", or the email when no name is known
export function displayName(user) {
    return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}
