/**
 * Workshop → Attributes tab (Project Short Fuse, Phase 2).
 *
 * Loaded by characterWorkshop.js the first time the tab is opened. Paints
 * the sheet it is given (one score per attribute with the D&D modifier
 * beside it, and the skills under it with a proficiency tick each) and
 * reports every change through ctx.onChange(scores, proficiencies). Saving
 * is the Workshop's: Save writes the draft's sheet with setSheet, Cancel
 * drops it. Nothing here touches settings.
 *
 * @module systems/ui/attributesPane
 */

import { escapeHtml } from '../../utils/html.js';
import {
    clampScore,
    modifier,
    formatModifier,
    roll4d6DropLowest,
    skillKey,
    isProficient,
    saveKey,
    isSaveProficient,
    getCastingAbility,
    withCastingAbility,
    castingCandidateIds,
    saveDC,
    castingCheckBonus,
    getTalents,
    withTalent,
    withoutTalent,
    normalizeTalentName,
    TIERS,
    tierById,
    getTier,
    withTier,
    tierFit,
    fillByTier,
    isSuggested,
    withSuggestedMark,
    STANDARD_ARRAY,
    DEFAULT_SCORE,
    MIN_SCORE,
    MAX_SCORE,
} from '../../utils/d20.js';

/** The host and context of the last render, for the delegated handlers. */
let last = null;

/**
 * @param {HTMLElement} host The pane's section element.
 * @param {{ name: string, isUser: boolean,
 *           defs: Array<{ id: string, name: string, abbr: string, enabled: boolean, skills?: string[] }>,
 *           scores: Record<string, number>, proficiencies: string[], profBonus: number,
 *           attributesOn: boolean,
 *           onChange: (scores: Record<string, number>, proficiencies: string[]) => void }} ctx
 */
export function renderAttributesPane(host, ctx) {
    if (!host) return;
    last = {
        host,
        ctx: {
            ...ctx,
            scores: { ...(ctx?.scores || {}) },
            proficiencies: Array.isArray(ctx?.proficiencies) ? [...ctx.proficiencies] : [],
        },
    };
    bindOnce(host);
    render();
}

function scoreOf(scores, id) {
    const v = clampScore(scores?.[id]);
    return v === null ? DEFAULT_SCORE : v;
}

function modClass(m) {
    return m > 0 ? ' is-pos' : m < 0 ? ' is-neg' : '';
}

function saveChipHtml(d, ctx) {
    const on = isSaveProficient(ctx.proficiencies, d.id);
    return `<button type="button" class="cw-attr-skill cw-attr-save${on ? ' is-prof' : ''}" data-save="1" role="checkbox" aria-checked="${on ? 'true' : 'false'}" title="${on ? `Proficient in ${escapeHtml(d.name)} saving throws: +${ctx.profBonus} to resist` : `Not proficient in ${escapeHtml(d.name)} saving throws`}">
            <i class="${on ? 'fa-solid fa-shield-halved' : 'fa-regular fa-square'}" aria-hidden="true"></i>Save
        </button>`;
}

/** The Casting chip on the mental attributes: one per sheet, the ability the character's powers run on. */
function castingChipHtml(d, ctx) {
    const defs = Array.isArray(ctx.defs) ? ctx.defs : [];
    if (!castingCandidateIds(defs).includes(d.id)) return '';
    const on = getCastingAbility(ctx.proficiencies) === d.id;
    return `<button type="button" class="cw-attr-skill cw-attr-casting${on ? ' is-prof' : ''}" data-casting="1" role="radio" aria-checked="${on ? 'true' : 'false'}" title="${on ? `Casting ability: anything ${escapeHtml(ctx.name || 'this character')}'s powers do to someone is resisted against ${escapeHtml(d.name)} (DC 8 + ${ctx.profBonus} + the modifier), and a casting check is ${escapeHtml(d.name)} with proficiency` : `Make ${escapeHtml(d.name)} the casting ability`}">
            <i class="${on ? 'fa-solid fa-wand-sparkles' : 'fa-regular fa-circle'}" aria-hidden="true"></i>Casting
        </button>${on ? `<span class="cw-attr-casting-nums" title="The spell save DC (8 + ${ctx.profBonus} + the modifier) and what a casting check adds (the modifier + ${ctx.profBonus})">${castingNumsText(scoreOf(ctx.scores, d.id), ctx.profBonus)}</span>` : ''}`;
}

/** "DC 20 · check +12" (§12): the save DC the power sets and what a casting check adds. */
function castingNumsText(score, profBonus) {
    const bonus = Number.isFinite(profBonus) ? profBonus : 2;
    return `DC ${saveDC(score, bonus)} · check ${formatModifier(castingCheckBonus(score, bonus))}`;
}

/** The Talents row (§12): what the character's magic is known for, Practised or Master, a name box to add one. */
function talentsHtml(ctx) {
    const talents = getTalents(ctx.proficiencies);
    const chips = talents.map(t => {
        const master = t.level === 'master';
        return `<span class="cw-attr-talent${master ? ' is-master' : ''}" data-talent="${escapeHtml(t.name)}">
                <button type="button" class="cw-attr-talent-level" aria-pressed="${master ? 'true' : 'false'}" title="${master ? 'Master: a casting check inside it rolls with advantage. Click for Practised' : 'Practised: a casting check inside it is proficient. Click for Master'}"><i class="${master ? 'fa-solid' : 'fa-regular'} fa-star" aria-hidden="true"></i></button>
                <span class="cw-attr-talent-name">${escapeHtml(t.name)}${master ? ' <small>(Master)</small>' : ''}</span>
                <button type="button" class="cw-attr-talent-remove" title="Remove ${escapeHtml(t.name)}" aria-label="Remove ${escapeHtml(t.name)}">&times;</button>
            </span>`;
    }).join('');
    return `<div class="cw-attr-talents">
            <span class="cw-attr-tier-label">Talents</span>
            <div class="cw-attr-talent-list">${chips || '<span class="cw-attr-noskills">None listed: the game master judges from the card.</span>'}</div>
            <span class="cw-attr-talent-add">
                <input type="text" class="rpg-input cw-attr-talent-input" maxlength="32" placeholder="Telepathy, Mist-walking…" aria-label="New talent" />
                <button type="button" class="rpg-btn cw-attr-talent-submit" title="Add it at Practised; the star makes it Master"><i class="fa-solid fa-plus"></i> Add</button>
            </span>
            <span class="cw-attr-tier-means">What their magic or powers are known for. It describes, never limits: a casting check inside a listed talent is proficient, inside a starred Master one it rolls with advantage, and anything else is simply unpractised.</span>
        </div>`;
}

/** Adds the typed talent at Practised and clears the box; nothing for an empty name. */
function addTalentFromInput(host) {
    const input = host.querySelector('.cw-attr-talent-input');
    if (!input || !last) return;
    const name = normalizeTalentName(input.value);
    if (!name) { input.value = ''; return; }
    commit({ proficiencies: withTalent(last.ctx.proficiencies, name, 'practised') }, { repaint: true });
    host.querySelector('.cw-attr-talent-input')?.focus();
}

function skillsHtml(d, ctx) {
    const list = Array.isArray(d.skills) ? d.skills : [];
    const save = saveChipHtml(d, ctx) + castingChipHtml(d, ctx);
    if (!list.length) return save + '<span class="cw-attr-noskills">No skills under this attribute.</span>';
    return save + list.map(sk => {
        const on = isProficient(ctx.proficiencies, d.id, sk);
        return `<button type="button" class="cw-attr-skill${on ? ' is-prof' : ''}" data-skill="${escapeHtml(sk)}" role="checkbox" aria-checked="${on ? 'true' : 'false'}" title="${on ? `Proficient: +${ctx.profBonus} on ${escapeHtml(sk)}` : `Not proficient in ${escapeHtml(sk)}`}">
            <i class="${on ? 'fa-solid fa-square-check' : 'fa-regular fa-square'}" aria-hidden="true"></i>${escapeHtml(sk)}
        </button>`;
    }).join('');
}

function render() {
    if (!last) return;
    const { host, ctx } = last;
    const defs = Array.isArray(ctx.defs) ? ctx.defs : [];
    const bonus = Number.isFinite(ctx.profBonus) ? ctx.profBonus : 2;
    const tierId = getTier(ctx.proficiencies);
    const rows = defs.map(d => {
        const score = scoreOf(ctx.scores, d.id);
        const m = modifier(score);
        return `<div class="cw-attr-row${d.enabled ? '' : ' is-off'}" data-attr="${escapeHtml(d.id)}">
            <div class="cw-attr-main">
                <span class="cw-attr-abbr">${escapeHtml(d.abbr)}</span>
                <span class="cw-attr-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}${d.enabled ? '' : ' <small>(off)</small>'}</span>
                <input type="number" class="rpg-input cw-attr-score${tierFit(score, tierId) === 'in' ? '' : ' is-off-tier'}" min="${MIN_SCORE}" max="${MAX_SCORE}" step="1" value="${score}" aria-label="${escapeHtml(d.name)} score"${offTierTitle(score, tierId)} />
                <span class="cw-attr-mod${modClass(m)}" title="What a roll adds">${escapeHtml(formatModifier(m))}</span>
            </div>
            <div class="cw-attr-skills">${skillsHtml(d, ctx)}</div>
        </div>`;
    }).join('');
    const tier = tierById(tierId);
    const tierRow = `<div class="cw-attr-tier-row">
            <label class="cw-attr-tier-label">Tier
                <select class="rpg-select cw-attr-tier" aria-label="Tier">
                    <option value=""${tierId ? '' : ' selected'}>None</option>
                    ${TIERS.map(t => `<option value="${t.id}"${t.id === tierId ? ' selected' : ''}>${escapeHtml(t.label)} (${t.min}–${t.max})</option>`).join('')}
                </select>
            </label>
            <button type="button" class="rpg-btn cw-attr-fill" title="${tier ? `The ${escapeHtml(tier.label)} array (${tier.array.join(', ')}) laid over the current ranking` : 'Pick a tier first'}"${tier ? '' : ' disabled'}><i class="fa-solid fa-layer-group"></i> Fill by tier</button>
            <button type="button" class="rpg-btn cw-attr-standard" title="15, 14, 13, 12, 10, 8 down the list; edit after"><i class="fa-solid fa-list-ol"></i> Standard array</button>
            <button type="button" class="rpg-btn cw-attr-4d6" title="Four six-sided dice, drop the lowest, once per attribute"><i class="fa-solid fa-dice"></i> Roll 4d6 drop lowest</button>
            <button type="button" class="rpg-btn cw-attr-reset" title="Every score back to 10; proficiencies stay"><i class="fa-solid fa-rotate-left"></i> All 10</button>
            <button type="button" class="rpg-btn cw-attr-suggest" title="One small call: the game master reads the card and the recent scene and proposes a tier and six scores. Nothing is kept until Save."><i class="fa-solid fa-wand-magic-sparkles"></i> Suggest from the story</button>
            ${isSuggested(ctx.proficiencies) ? '<span class="cw-attr-badge" title="The game master filled this sheet on its own; it stays marked until you change something here">AI-suggested</span>' : ''}
        </div>
        <p class="helper cw-attr-tier-means">${tier ? `${escapeHtml(tier.means)}; scores outside ${tier.min}–${tier.max} are marked` : 'where this character stands, from ordinary people to legends'}</p>`;
    const helper = ctx.isUser
        ? `Your scores, 1 to 30. The modifier beside each is what a roll adds: 10 and 11 give +0, and every two points above or below move it by one. Tick the skills you are proficient in; each adds +${bonus} to a roll on it, whichever attribute the check pairs it with. Save marks a saving throw you are proficient in (+${bonus} to resist what is done to you). Casting marks the one ability your magic or powers run on: anything they do to someone is resisted against it, DC 8 + ${bonus} + its modifier, and a casting check (magic against the world) is that ability with proficiency. Tag a message with the d20 button and this is the sheet it rolls on.`
        : `${escapeHtml(ctx.name || 'This character')}'s scores, 1 to 30, the skills they are proficient in (+${bonus} each) and the saving throws (Save) they are proficient in. NPCs never roll (the dice are yours), but a sheet that is not all 10s, or has proficiencies, goes to the AI with yours so it can play them to their strengths.`;
    host.innerHTML = `
        <h4>&#127922; Attributes <span class="rpg-accordion-badge rpg-beta-badge">Beta</span></h4>
        <p class="helper">${helper}</p>
        ${ctx.attributesOn ? '' : '<div class="cw-attr-notice"><i class="fa-solid fa-circle-info"></i><span>Attributes are off in <strong>Settings &rarr; Stats &rarr; Attributes &amp; checks</strong>. The sheet is kept; nothing is sent or rolled until they are on.</span></div>'}
        ${defs.length ? tierRow : ''}
        ${defs.length
            ? `<div class="cw-attr-grid">${rows}</div>${talentsHtml(ctx)}`
            : '<div class="rpg-dc-knives-empty">No attributes on the list. Add some in Settings &rarr; Stats &rarr; Attributes &amp; checks.</div>'}
        <p class="helper cw-attr-foot">Saved with <strong>Save</strong>. A sheet that is all 10s with no proficiencies is the default and is never sent.</p>`;
}

/** The title on a score box outside its tier's range, or ''. */
function offTierTitle(score, tierId) {
    const t = tierById(tierId);
    if (!t || tierFit(score, tierId) === 'in') return '';
    return ` title="Outside the ${escapeHtml(t.label)} range (${t.min}–${t.max}); allowed, just unusual"`;
}

/** Updates the draft through ctx.onChange; repaints when a whole-sheet action asks for it. Any change clears the suggested mark: the owner has looked. */
function commit({ scores, proficiencies }, { repaint = false } = {}) {
    if (!last) return;
    if (scores) last.ctx.scores = scores;
    last.ctx.proficiencies = withSuggestedMark(proficiencies || last.ctx.proficiencies, false);
    try {
        last.ctx.onChange?.({ ...last.ctx.scores }, [...last.ctx.proficiencies]);
    } catch (e) {
        console.warn('[DES Workshop] attributes change failed', e);
    }
    if (repaint) render();
}

function paintModifier(row, score) {
    const mod = row?.querySelector('.cw-attr-mod');
    if (!mod) return;
    const m = modifier(score);
    mod.textContent = formatModifier(m);
    mod.className = `cw-attr-mod${modClass(m)}`;
    // The range mark follows the score as it is typed.
    const input = row.querySelector('.cw-attr-score');
    if (input && last) {
        const tierId = getTier(last.ctx.proficiencies);
        const off = tierFit(score, tierId) !== 'in';
        input.classList.toggle('is-off-tier', off);
        const t = tierById(tierId);
        if (off && t) input.title = `Outside the ${t.label} range (${t.min}–${t.max}); allowed, just unusual`;
        else input.removeAttribute('title');
    }
    // The casting readout follows too, when this row is the casting ability.
    const nums = row.querySelector('.cw-attr-casting-nums');
    if (nums && last) nums.textContent = castingNumsText(score, last.ctx.profBonus);
}

function bindOnce(host) {
    if (host.dataset.cwAttrBound === '1') return;
    host.dataset.cwAttrBound = '1';

    // Typing: the modifier follows at once; a half-typed or empty box waits.
    host.addEventListener('input', (e) => {
        const input = e.target?.closest?.('.cw-attr-score');
        if (!input || !last) return;
        const row = input.closest('.cw-attr-row');
        const id = row?.dataset.attr;
        if (!id || String(input.value).trim() === '') return;
        const v = clampScore(input.value);
        if (v === null) return;
        paintModifier(row, v);
        commit({ scores: { ...last.ctx.scores, [id]: v } });
    });

    // Enter in the talent box adds it (no form: the Workshop popup is not one).
    host.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !e.target?.closest?.('.cw-attr-talent-input')) return;
        e.preventDefault();
        addTalentFromInput(host);
    });

    // Leaving the box: clamp into range, or fall back to the last good score.
    host.addEventListener('change', (e) => {
        // The Tier select: one word on the sheet; the whole pane repaints so the range marks follow.
        const tierSel = e.target?.closest?.('.cw-attr-tier');
        if (tierSel && last) {
            commit({ proficiencies: withTier(last.ctx.proficiencies, tierSel.value) }, { repaint: true });
            return;
        }
        const input = e.target?.closest?.('.cw-attr-score');
        if (!input || !last) return;
        const row = input.closest('.cw-attr-row');
        const id = row?.dataset.attr;
        if (!id) return;
        const typed = String(input.value).trim() === '' ? null : clampScore(input.value);
        const score = typed === null ? scoreOf(last.ctx.scores, id) : typed;
        input.value = String(score);
        paintModifier(row, score);
        commit({ scores: { ...last.ctx.scores, [id]: score } });
    });

    host.addEventListener('click', (e) => {
        const btn = e.target?.closest?.('button');
        if (!btn || !last || !host.contains(btn)) return;
        const defs = Array.isArray(last.ctx.defs) ? last.ctx.defs : [];

        // A skill chip: toggle the proficiency and repaint that chip alone.
        // Fill by tier: the tier's array over the current ranking (§11.3).
        if (btn.classList.contains('cw-attr-fill')) {
            const tierId = getTier(last.ctx.proficiencies);
            const next = fillByTier(last.ctx.scores, defs, tierId);
            if (Object.keys(next).length) commit({ scores: { ...last.ctx.scores, ...next } }, { repaint: true });
            return;
        }
        // Suggest from the story: one small call; the answer lands on the draft, Save keeps it.
        if (btn.classList.contains('cw-attr-suggest')) {
            if (btn.disabled) return;
            btn.disabled = true;
            const label = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Asking the game master…';
            import('../features/sheetSuggest.js')
                .then(m => m.suggestSheet({ name: last.ctx.name, isUser: !!last.ctx.isUser, description: last.ctx.description || '', appearance: last.ctx.appearance || '' }))
                .then(s => {
                    if (!last) return;
                    const scores = { ...last.ctx.scores, ...s.scores };
                    const profs = s.tierId ? withTier(last.ctx.proficiencies, s.tierId) : last.ctx.proficiencies;
                    commit({ scores, proficiencies: profs }, { repaint: true });
                    const t = tierById(s.tierId);
                    const why = Object.entries(s.reasons || {}).map(([id, r]) => `${(defs.find(d => d.id === id) || {}).name || id}: ${r}`).join(' · ');
                    try { window.toastr?.info?.(`${t ? `${t.label}. ` : ''}${why || 'Scores proposed.'} Save to keep them.`, 'Suggested stats', { timeOut: 9000, escapeHtml: true }); } catch (e) { /* no toastr */ }
                })
                .catch(err => {
                    console.warn('[DES Workshop] suggestion failed', err);
                    try { window.toastr?.warning?.(`The game master could not rate this character: ${err?.message || err}`, 'Suggested stats', { timeOut: 6000, escapeHtml: true }); } catch (e) { /* no toastr */ }
                    if (btn.isConnected) { btn.disabled = false; btn.innerHTML = label; }
                });
            return;
        }
        // The Casting chip: one ability per sheet, so the row repaints as a whole.
        if (btn.classList.contains('cw-attr-casting')) {
            const id = btn.closest('.cw-attr-row')?.dataset.attr;
            if (!id) return;
            const current = getCastingAbility(last.ctx.proficiencies);
            commit({ proficiencies: withCastingAbility(last.ctx.proficiencies, current === id ? '' : id) }, { repaint: true });
            return;
        }
        // Talents (§12): add from the box, star for Master, cross to remove.
        if (btn.classList.contains('cw-attr-talent-submit')) {
            addTalentFromInput(host);
            return;
        }
        if (btn.classList.contains('cw-attr-talent-level') || btn.classList.contains('cw-attr-talent-remove')) {
            const name = btn.closest('.cw-attr-talent')?.dataset.talent || '';
            if (!name) return;
            if (btn.classList.contains('cw-attr-talent-remove')) {
                commit({ proficiencies: withoutTalent(last.ctx.proficiencies, name) }, { repaint: true });
            } else {
                const t = getTalents(last.ctx.proficiencies).find(x => x.name === name);
                commit({ proficiencies: withTalent(last.ctx.proficiencies, name, t && t.level === 'master' ? 'practised' : 'master') }, { repaint: true });
            }
            return;
        }
        if (btn.classList.contains('cw-attr-skill')) {
            const id = btn.closest('.cw-attr-row')?.dataset.attr;
            const isSave = btn.dataset.save === '1';
            const sk = btn.dataset.skill || '';
            if (!id || (!sk && !isSave)) return;
            const key = isSave ? saveKey(id) : skillKey(id, sk);
            const has = last.ctx.proficiencies.includes(key);
            const next = has ? last.ctx.proficiencies.filter(k => k !== key) : [...last.ctx.proficiencies, key].sort();
            const on = !has;
            btn.classList.toggle('is-prof', on);
            btn.setAttribute('aria-checked', on ? 'true' : 'false');
            const name = defs.find(d => d.id === id)?.name || id;
            btn.title = isSave
                ? (on ? `Proficient in ${name} saving throws: +${last.ctx.profBonus} to resist` : `Not proficient in ${name} saving throws`)
                : (on ? `Proficient: +${last.ctx.profBonus} on ${sk}` : `Not proficient in ${sk}`);
            const icon = btn.querySelector('i');
            if (icon) icon.className = on ? (isSave ? 'fa-solid fa-shield-halved' : 'fa-solid fa-square-check') : 'fa-regular fa-square';
            commit({ proficiencies: next });
            return;
        }

        const on = defs.filter(d => d.enabled);
        const targets = on.length ? on : defs;
        if (btn.classList.contains('cw-attr-standard')) {
            const next = { ...last.ctx.scores };
            targets.forEach((d, i) => { next[d.id] = STANDARD_ARRAY[i] ?? DEFAULT_SCORE; });
            commit({ scores: next }, { repaint: true });
        } else if (btn.classList.contains('cw-attr-4d6')) {
            const next = { ...last.ctx.scores };
            targets.forEach(d => { next[d.id] = roll4d6DropLowest(); });
            commit({ scores: next }, { repaint: true });
            flash(host);
        } else if (btn.classList.contains('cw-attr-reset')) {
            const next = {};
            defs.forEach(d => { next[d.id] = DEFAULT_SCORE; });
            commit({ scores: next }, { repaint: true });
        }
    });
}

/** A short brightness pulse on the modifiers after a roll (CSS; off under reduced motion and perf mode). */
function flash(host) {
    const grid = host.querySelector('.cw-attr-grid');
    if (!grid) return;
    grid.classList.remove('is-rolled');
    void grid.offsetWidth;
    grid.classList.add('is-rolled');
}
