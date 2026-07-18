/**
 * Name similarity for duplicate-character detection.
 *
 * Used by the Character Roster's new-character dialog: creating "Sara" when
 * "Sarah" already exists (or "Sarah Greenfield" when it's already an alias of
 * "Sarah") usually means the user wants the SAME character — the roster offers
 * to record the new name as an alias instead of birthing a duplicate card.
 *
 * Pure string logic, no DES imports — keep it importable from node tests.
 */

/** Lowercase, strip diacritics, collapse whitespace. */
export function normalizeName(name) {
    return String(name || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

/**
 * Iterative Levenshtein distance with an early-exit cap — names are short,
 * and anything beyond `cap` is "not similar" so the exact value is unneeded.
 */
export function levenshtein(a, b, cap = 3) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            curr[j] = Math.min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
            if (curr[j] < rowMin) rowMin = curr[j];
        }
        if (rowMin > cap) return cap + 1;
        prev = curr;
    }
    return prev[b.length];
}

/** One name's word set contained in the other's ("Sarah" ⊆ "Sarah Greenfield"). */
function tokenSubset(a, b) {
    const ta = a.split(' ');
    const tb = b.split(' ');
    const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    const largeSet = new Set(large);
    return small.every(t => largeSet.has(t));
}

/**
 * Are two (distinct) names similar enough to suspect the same character?
 * - small edit distance (typo / spelling variant: Sara/Sarah, Nyx/Nix)
 * - token containment (first name vs revealed full name)
 * - space-boundary prefix (namesMatchLoose semantics)
 */
export function namesAreSimilar(a, b) {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb || na === nb) return false; // exact match is the caller's dup-check job
    const maxDist = Math.min(na.length, nb.length) <= 5 ? 1 : 2;
    if (levenshtein(na, nb, maxDist) <= maxDist) return true;
    if (tokenSubset(na, nb)) return true;
    return na.startsWith(nb + ' ') || nb.startsWith(na + ' ');
}

/**
 * Finds the best similar entry for a candidate name.
 *
 * @param {string} candidate - the name the user is trying to create
 * @param {Array<{name: string, canonical: string, isUser?: boolean}>} entries
 *        Pool of existing names. For a real card, name === canonical; for an
 *        alias, name is the alias and canonical is the owning card.
 * @returns {{name, canonical, isUser, exactNormalized, distance} | null}
 */
export function findSimilarCharacter(candidate, entries) {
    const nc = normalizeName(candidate);
    if (!nc) return null;
    let best = null;
    for (const entry of entries) {
        if (!entry?.name) continue;
        const ne = normalizeName(entry.name);
        if (!ne) continue;
        if (ne === nc) {
            // Same name after normalization — an existing alias, or a card
            // name differing only in diacritics/spacing (which the roster's
            // plain-lowercase dup-check misses). Highest priority.
            return { ...entry, exactNormalized: true, distance: 0 };
        }
        if (!namesAreSimilar(nc, ne)) continue;
        const distance = levenshtein(nc, ne, 6);
        if (!best
            || distance < best.distance
            // Prefer canonical-card hits over alias hits at equal distance.
            || (distance === best.distance && best.name !== best.canonical && entry.name === entry.canonical)) {
            best = { ...entry, exactNormalized: false, distance };
        }
    }
    return best;
}
