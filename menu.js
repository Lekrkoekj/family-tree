// A button that opens a small menu underneath it.
// items: [{ label, onclick, danger? }]; onclick may be async (errors are shown with an alert).

import { iconButton } from "./icons.js";
import { friendlyError } from "./ui.js";

let openMenu = null; // only one menu is open at a time

export function menuButton(iconName, label, items) {
    const wrapper = document.createElement("div");
    wrapper.className = "menu-wrapper";

    const list = document.createElement("div");
    list.className = "menu-list";
    list.setAttribute("role", "menu");
    list.hidden = true;

    for (const item of items) {
        const option = document.createElement("button");
        option.type = "button";
        option.setAttribute("role", "menuitem");
        option.textContent = item.label;
        if (item.danger) option.className = "danger";
        option.onclick = async () => {
            close();
            try {
                await item.onclick();
            } catch (error) {
                console.error(error);
                alert(friendlyError(error));
            }
        };
        list.append(option);
    }

    const button = iconButton(iconName, label, () => (list.hidden ? open() : close()));
    button.setAttribute("aria-haspopup", "menu");
    wrapper.append(button, list);

    function open() {
        openMenu?.();
        list.hidden = false;
        openMenu = close;
        // Close on a click anywhere else, or Escape. Added a moment later so this click doesn't close it again.
        setTimeout(() => {
            document.addEventListener("pointerdown", onOutside, true);
            document.addEventListener("keydown", onKey);
        });
    }

    function close() {
        list.hidden = true;
        if (openMenu === close) openMenu = null;
        document.removeEventListener("pointerdown", onOutside, true);
        document.removeEventListener("keydown", onKey);
    }

    function onOutside(event) {
        if (!wrapper.contains(event.target)) close();
    }

    function onKey(event) {
        if (event.key === "Escape") close();
    }

    return wrapper;
}
