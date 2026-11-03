/**
 * The windows' order (docs/hub-plan.md §4.4): the Map window, the World
 * Builder and the Hub each close on Escape and on a click on their own
 * backdrop; opened over one another, only the one on top should answer.
 * Each pushes its name when it opens and pops it when it closes, and asks
 * `isTopmost` before closing on a key.
 */
const stack = [];

export function pushWindow(name) {
    popWindow(name);
    stack.push(String(name));
}

export function popWindow(name) {
    const i = stack.lastIndexOf(String(name));
    if (i >= 0) stack.splice(i, 1);
}

export function isTopmost(name) {
    return stack.length > 0 && stack[stack.length - 1] === String(name);
}

export function topWindow() {
    return stack.length ? stack[stack.length - 1] : '';
}
