/**
 * The knock (docs/long-shot-plan.md D201): three quick taps in one spot,
 * which hide the Doom button or bring it back. Pure: what counts as a
 * tap, and when taps make a knock. The DOM's side is in
 * src/systems/ui/fabMenu.js.
 */
export const KNOCK = Object.freeze({
    taps: 3,       // how many make a knock
    gapMs: 450,    // the longest wait between one tap and the next
    radius: 48,    // how far from the first tap the others may land, in CSS pixels
    holdMs: 350,   // a press held longer than this is not a tap
    slop: 12,      // a press that moved further than this is a scroll or a drag
});

/** Whether a press was a tap: short, and without the finger moving. */
export function isTap(down, up, rules = KNOCK) {
    if (!down || !up) return false;
    return up.t - down.t <= rules.holdMs && up.t >= down.t && Math.hypot(up.x - down.x, up.y - down.y) <= rules.slop;
}

/**
 * Counts taps into knocks. `tap({ t, x, y })` is told each finished tap
 * and answers true on the one that completes a knock; a tap that comes
 * too late or lands too far from the first starts the count again with
 * itself. After a knock the count starts from nothing, so six quick taps
 * are two knocks, not four.
 */
export function knockCounter(rules = KNOCK) {
    let seq = [];
    return {
        tap(p) {
            const at = { t: Number(p && p.t) || 0, x: Number(p && p.x) || 0, y: Number(p && p.y) || 0 };
            const last = seq[seq.length - 1];
            if (last && (at.t - last.t > rules.gapMs || at.t < last.t || Math.hypot(at.x - seq[0].x, at.y - seq[0].y) > rules.radius)) seq = [];
            seq.push(at);
            if (seq.length < rules.taps) return false;
            seq = [];
            return true;
        },
        reset() { seq = []; },
        count() { return seq.length; },
    };
}
