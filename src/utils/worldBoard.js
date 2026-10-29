/**
 * Live World, the faces (docs/map-window-plan.md D85, D87): the pure part
 * the Map window's People panel and the face popover read. The board of
 * tiles that lived here (D69) is gone; what stands is where each known
 * character was last seen, a safe image URL, and a character's place.
 *
 * No SillyTavern imports: tools/world-map-test.mjs imports this directly.
 */
import { placeLabel, sameName } from './liveWorld.js';

/** An image reference a pack may give a place, or '' when it is not a plain http(s), data-image or relative URL. */
export function safeImageUrl(url) {
    // A picture saved under the chat's character folder has that name in its path, spaces and all
    // ("/user/images/Starclaw 2 - Narrator/des-place-….png"): kept, the spaces encoded for a CSS url()
    // and an <img src>. Quotes, angle brackets and control characters are out; so is any scheme but
    // http(s) and data:image.
    const s = String(url || '').trim().replace(/[ \t]+/g, '%20');
    if (!s || /[\s"'<>\x00-\x1f\x7f]/.test(s)) return '';
    if (/^https?:\/\//i.test(s) || /^data:image\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return '';    // any other scheme
    return s.startsWith('//') ? '' : s;
}

/** The place a character stands in, as a path's deepest id, or '' . */
export function placeOf(state, name) {
    const path = state && state.where ? state.where[name] : '';
    return path ? String(path).split('/').filter(Boolean).pop() : '';
}

/**
 * The faces the shelf's World page shows: each known character with where
 * they were last seen, when, and where before that; the heard-of names.
 * @returns {{ known: Array<{name: string, place: string, path: string, gameDate: string, gameTime: string, before: string, reason: string}>, heard: string[] }}
 */
export function facesOfTheWorld(pack, state) {
    const log = (state && state.log) || [];
    const known = Object.entries((state && state.known) || {}).filter(([, t]) => t === 'known').map(([n]) => n).sort((a, b) => a.localeCompare(b));
    const faces = known.map(name => {
        let last = null;
        for (let i = log.length - 1; i >= 0; i--) if (log[i].kind === 'move' && sameName(log[i].who, name)) { last = log[i]; break; }
        const path = state.where && state.where[name] ? state.where[name] : '';
        return {
            name,
            place: path ? placeLabel(pack, path) : '',
            path,
            gameDate: last && last.gameDate ? last.gameDate : '',
            gameTime: last && last.gameTime ? last.gameTime : '',
            before: last && last.from ? placeLabel(pack, last.from) : '',
            reason: last && last.reason ? last.reason : '',
        };
    });
    const heard = Object.entries((state && state.known) || {}).filter(([, t]) => t === 'heard').map(([n]) => n).sort((a, b) => a.localeCompare(b));
    return { known: faces, heard };
}
