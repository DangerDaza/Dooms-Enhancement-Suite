/**
 * Dice panel — the "Roll a check" popover and the chip above the message box
 * (Project Short Fuse, Phase 2).
 *
 * Loaded on first use (dynamic import from the entry points), like the
 * other modals. The popover's markup lives in template.html; its body is
 * rendered from state here.
 *
 * The player decides three things here: the attribute, a skill under it
 * (or a plain check), and a line of context for the game master. OK tags
 * the next message and closes. The ruling, the roll and the box at the top
 * of the reply all happen when the message is sent
 * (diceRolls.onDiceMessageSent). With the override setting on, a difficulty
 * row lets the player fix the ruling instead of asking.
 */
import { extensionSettings } from '../../core/state.js';
import { ensureSettingsUI } from '../../core/lazyUI.js';
import { escapeHtml } from '../../utils/html.js';
import { attributesConfig, attributeDefs, attributesOn, difficultyTable, formatModifier, modifier, isProficient, findSkill } from '../../utils/d20.js';
import {
    DICE_CHANGED_EVENT,
    getPendingCheck,
    getPersonaSheet,
    tagCheck,
    clearPendingCheck,
} from '../features/diceRolls.js';

const POPUP_ID = 'rpg-dice-popup';
const CHIP_ID = 'dooms-dice-chip';

let bound = false;
let lastAttributeId = null;     // the chip the player used last (session only)
// What the player has picked since opening, seeded from the pending check.
let draft = { attributeId: null, skill: '', otherSkills: false, difficultyId: '', advantage: 'none' };

// ─── Open / close ───────────────────────────────────────────────────────────

/** Opens the popover (loading the deferred template first if needed). */
export function openDicePanel() {
    return ensureSettingsUI().then(() => {
        bindOnce();
        mountChip();
        const $popup = $('#' + POPUP_ID);
        if (!$popup.length) {
            console.warn('[Dooms Tracker] Dice popup not found — template not loaded?');
            return;
        }
        seedDraft();
        render();
        $popup.css('display', 'flex');
        setTimeout(() => { $('#rpg-dice-context').trigger('focus'); }, 30);
    }).catch(err => console.error('[Dooms Tracker] Dice panel failed to open:', err));
}

function closeDicePanel() {
    $('#' + POPUP_ID).css('display', 'none');
}

function isOpen() {
    return $('#' + POPUP_ID).css('display') === 'flex';
}

function seedDraft() {
    const defs = attributeDefs(extensionSettings);
    const pending = getPendingCheck();
    let id = null;
    if (pending && defs.some(d => d.id === pending.attributeId)) id = pending.attributeId;
    else if (lastAttributeId && defs.some(d => d.id === lastAttributeId)) id = lastAttributeId;
    else id = defs[0]?.id || null;
    const skill = pending && pending.attributeId === id ? pending.skill : '';
    draft = {
        attributeId: id,
        skill,
        // A borrowed skill opens the "Other skills" row so it can be seen.
        otherSkills: !!(pending && skill && pending.skillAttributeId && pending.skillAttributeId !== id),
        difficultyId: pending?.override?.difficultyId || '',
        advantage: pending?.override?.advantage || 'none',
    };
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function render() {
    const $body = $('#rpg-dice-body');
    if (!$body.length) return;
    if (!attributesOn(extensionSettings)) {
        $body.html('<p class="rpg-dice-hint">Attributes are off. Turn them on in <b>Settings → Stats → Attributes &amp; checks</b> to roll checks.</p>');
        return;
    }
    const cfg = attributesConfig(extensionSettings);
    const defs = attributeDefs(extensionSettings);
    const persona = getPersonaSheet();
    const pending = getPendingCheck();
    if (!draft.attributeId || !defs.some(d => d.id === draft.attributeId)) draft.attributeId = defs[0]?.id || null;
    const def = defs.find(d => d.id === draft.attributeId) || null;
    const name = persona ? persona.name : 'You';
    const profs = persona ? persona.proficiencies : [];

    const chips = defs.map(d => {
        const score = persona ? persona.sheet[d.id] : 10;
        const m = modifier(score);
        const sel = d.id === draft.attributeId ? ' is-selected' : '';
        return `<button type="button" class="rpg-dice-chip-btn rpg-dice-attr${sel}" data-id="${escapeHtml(d.id)}" title="${escapeHtml(d.name)} ${score}">
            <span class="rpg-dice-attr-abbr">${escapeHtml(d.abbr)}</span>
            <span class="rpg-dice-attr-mod">${escapeHtml(formatModifier(m))}</span>
        </button>`;
    }).join('');

    // The skills: a plain check first, then the chosen attribute's own
    // skills, then (behind "Other skills") every other attribute's, each
    // tagged with its home. Any skill may pair with any attribute; the
    // proficiency follows the skill, so the tick is read from its home.
    let skills = '';
    if (def) {
        const hit = findSkill(defs, draft.skill);
        if (draft.skill && !hit) draft.skill = '';
        const sel = (sk) => !!hit && hit.name.toLowerCase() === sk.toLowerCase();
        const chip = (homeId, sk, tag) => {
            const prof = isProficient(profs, homeId, sk);
            const title = prof ? `Proficient: +${cfg.proficiencyBonus} on this skill` : sk;
            return `<button type="button" class="rpg-dice-chip-btn rpg-dice-skill${sel(sk) ? ' is-selected' : ''}${prof ? ' is-prof' : ''}" data-skill="${escapeHtml(sk)}" title="${escapeHtml(title)}">${escapeHtml(sk)}${tag ? `<small class="rpg-dice-skill-home">${escapeHtml(tag)}</small>` : ''}${prof ? `<span class="rpg-dice-skill-prof">+${cfg.proficiencyBonus}</span>` : ''}</button>`;
        };
        const own = (Array.isArray(def.skills) ? def.skills : []).map(sk => chip(def.id, sk, '')).join('');
        const plain = `<button type="button" class="rpg-dice-chip-btn rpg-dice-skill${!draft.skill ? ' is-selected' : ''}" data-skill="" title="The attribute alone">Plain ${escapeHtml(def.name)} check</button>`;
        const others = defs.filter(d => d.id !== def.id && Array.isArray(d.skills) && d.skills.length);
        const borrowed = !!hit && hit.attributeId !== def.id;
        const open = draft.otherSkills || borrowed;
        const toggle = others.length
            ? `<button type="button" class="rpg-dice-chip-btn rpg-dice-others${open ? ' is-selected' : ''}" title="Pair this attribute with a skill from another one (the Skills with Different Abilities variant)">Other skills ${open ? '&#9662;' : '&#9656;'}</button>`
            : '';
        const otherRow = open && others.length
            ? `<div class="rpg-dice-skills rpg-dice-skills-other">${others.map(d => d.skills.map(sk => chip(d.id, sk, d.abbr)).join('')).join('')}</div>`
            : '';
        skills = `<div class="rpg-dice-skills">${plain}${own}${toggle}</div>${otherRow}`;
    }

    const sheetNote = persona && persona.isDefault
        ? `<p class="rpg-dice-hint">${escapeHtml(name)}'s sheet is all 10s with no proficiencies, so every check rolls at +0. <button type="button" class="rpg-link-btn rpg-dice-open-workshop">Set attributes in the Workshop</button></p>`
        : '';

    // Keep what the player has typed across repaints; seed from the pending check.
    const typed = $('#rpg-dice-context').val();
    const context = typed !== undefined ? String(typed) : (pending ? pending.context : '');

    let override = '';
    if (cfg.allowOverride) {
        const dchips = [
            `<button type="button" class="rpg-dice-chip-btn rpg-dice-diff${!draft.difficultyId ? ' is-selected' : ''}" data-diff="" title="Ask the game master when you send">Game master decides</button>`,
            ...difficultyTable(extensionSettings).map(d =>
                `<button type="button" class="rpg-dice-chip-btn rpg-dice-diff${d.id === draft.difficultyId ? ' is-selected' : ''}" data-diff="${escapeHtml(d.id)}" title="DC ${d.dc}">${escapeHtml(d.label)} <small>${d.dc}</small></button>`),
        ].join('');
        const advSel = draft.difficultyId ? `<select class="rpg-dice-adv rpg-accordion-input" title="Advantage">
            <option value="none"${draft.advantage === 'none' ? ' selected' : ''}>No advantage</option>
            <option value="adv"${draft.advantage === 'adv' ? ' selected' : ''}>Advantage</option>
            <option value="dis"${draft.advantage === 'dis' ? ' selected' : ''}>Disadvantage</option>
        </select>` : '';
        override = `<div class="rpg-dice-override"><span class="rpg-dice-override-label">Difficulty:</span>${dchips}${advSel}</div>`;
    }

    const howRuled = cfg.aiRatesDifficulty
        ? 'When you send, your AI rules how hard it is, the die is rolled, and the result shows at the top of the reply.'
        : 'When you send, the die is rolled against the default difficulty and the result shows at the top of the reply.';
    let status = '';
    if (pending && pending.calledBy === 'gm' && pending.gmRuling) {
        const r = pending.gmRuling;
        const adv = r.advantage === 'adv' ? ', with advantage' : r.advantage === 'dis' ? ', with disadvantage' : '';
        status = `<p class="rpg-dice-hint rpg-dice-pending">🎲 The game master calls for a <b>${escapeHtml(pending.abbr)}${pending.skill ? ` (${escapeHtml(pending.skill)})` : ''}</b> ${pending.kind === 'save' ? 'saving throw' : 'check'}, <b>${escapeHtml(r.label)}</b> (DC ${r.dc})${adv}${r.reason ? `: ${escapeHtml(r.reason)}` : ''}. It rolls when you send. OK keeps that ruling with your pick above; Discard declines it.</p>`;
    } else if (pending) {
        status = `<p class="rpg-dice-hint rpg-dice-pending">🎲 A <b>${escapeHtml(pending.abbr)}${pending.skill ? ` (${escapeHtml(pending.skill)})` : ''}</b> ${pending.kind === 'save' ? 'saving throw' : 'check'} is tagged and rolls when you send. OK replaces it.</p>`;
    }

    $body.html(`
        <div class="rpg-dice-who">Checking as <b>${escapeHtml(name)}</b></div>
        <div class="rpg-dice-attrs">${chips}</div>
        ${skills}
        ${sheetNote}
        <label class="rpg-dice-attempt-label">What are you attempting? <small>Optional. A line of context for the game master.</small>
            <input type="text" id="rpg-dice-context" class="rpg-accordion-input" maxlength="300"
                value="${escapeHtml(context)}" placeholder="e.g. climb the wet wall before the guards turn" />
        </label>
        ${override}
        <p class="rpg-dice-hint">${howRuled}</p>
        ${status}
        <div class="rpg-dice-actions">
            <button type="button" class="rpg-btn rpg-btn-primary rpg-dice-ok"${def ? '' : ' disabled'}>OK</button>
            ${pending
                ? '<button type="button" class="rpg-btn rpg-dice-discard" title="Drop the tagged check; nothing rolls">Discard check</button>'
                : '<button type="button" class="rpg-btn rpg-dice-cancel">Cancel</button>'}
        </div>
    `);
}

// ─── The chip above the message box ─────────────────────────────────────────

function mountChip() {
    if ($('#' + CHIP_ID).length) return;
    const $form = $('#send_form');
    if (!$form.length) return;
    const $chip = $(`<div id="${CHIP_ID}" class="dooms-dice-chip" style="display:none;" role="status">
        <span class="dooms-dice-chip-text"></span>
        <button type="button" class="dooms-dice-chip-x" title="Discard this check">&times;</button>
    </div>`);
    $form.before($chip);
}

function updateChip() {
    const $chip = $('#' + CHIP_ID);
    if (!$chip.length) return;
    const pending = getPendingCheck();
    if (!pending || !attributesOn(extensionSettings)) {
        $chip.hide();
        return;
    }
    const what = `${pending.abbr}${pending.skill ? ` (${pending.skill})` : ''} ${pending.kind === 'save' ? 'saving throw' : 'check'}`;
    let text;
    if (pending.rating) {
        text = `🎲 ${what} · asking the game master…`;
    } else if (pending.calledBy === 'gm' && pending.gmRuling && !pending.override) {
        const r = pending.gmRuling;
        const adv = r.advantage === 'adv' ? ', advantage' : r.advantage === 'dis' ? ', disadvantage' : '';
        text = `🎲 The game master calls for a ${what} · ${r.label} (DC ${r.dc})${adv} · rolls when you send`;
    } else if (pending.override) {
        const o = pending.override;
        const adv = o.advantage === 'adv' ? ', advantage' : o.advantage === 'dis' ? ', disadvantage' : '';
        text = `🎲 ${what} · ${o.label} (DC ${o.dc})${adv} · rolls when you send`;
    } else {
        text = `🎲 ${what} · rolls when you send`;
    }
    $chip.find('.dooms-dice-chip-text').text(text);
    $chip.find('.dooms-dice-chip-x').toggle(!pending.rating);
    $chip.show();
}

// ─── Events ─────────────────────────────────────────────────────────────────

function confirm() {
    if (!draft.attributeId) return;
    lastAttributeId = draft.attributeId;
    // A check the game master called for keeps its ruling under the player's pick.
    const pending = getPendingCheck();
    const gm = pending && pending.calledBy === 'gm' ? pending : null;
    tagCheck({
        attributeId: draft.attributeId,
        skill: draft.skill,
        context: String($('#rpg-dice-context').val() || ''),
        override: draft.difficultyId ? { difficultyId: draft.difficultyId, advantage: draft.advantage } : null,
        gmRuling: gm ? gm.gmRuling : null,
        fromIndex: gm ? gm.fromIndex : -1,
    });
    closeDicePanel();
}

function bindOnce() {
    if (bound) return;
    bound = true;
    $(document).on('click', '#rpg-dice-close, #rpg-dice-body .rpg-dice-cancel', closeDicePanel);
    $(document).on('click', '#rpg-dice-body .rpg-dice-attr', function () {
        const id = String($(this).data('id'));
        // A new attribute starts as a plain check: a pairing across attributes
        // is picked on purpose from "Other skills", never left over.
        if (id !== draft.attributeId) { draft.attributeId = id; draft.skill = ''; draft.otherSkills = false; }
        render();
    });
    $(document).on('click', '#rpg-dice-body .rpg-dice-skill', function () {
        draft.skill = String($(this).data('skill') || '');
        render();
    });
    $(document).on('click', '#rpg-dice-body .rpg-dice-others', function () {
        draft.otherSkills = !draft.otherSkills;
        render();
    });
    $(document).on('click', '#rpg-dice-body .rpg-dice-diff', function () {
        draft.difficultyId = String($(this).data('diff') || '');
        if (!draft.difficultyId) draft.advantage = 'none';
        render();
    });
    $(document).on('change', '#rpg-dice-body .rpg-dice-adv', function () {
        draft.advantage = String($(this).val() || 'none');
    });
    $(document).on('click', '#rpg-dice-body .rpg-dice-ok', confirm);
    $(document).on('keydown', '#rpg-dice-context', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    });
    $(document).on('click', '#rpg-dice-body .rpg-dice-discard', function () {
        clearPendingCheck();
        closeDicePanel();
    });
    $(document).on('click', '#rpg-dice-body .rpg-dice-open-workshop', function () {
        const persona = getPersonaSheet();
        closeDicePanel();
        if (persona) {
            try { window.dispatchEvent(new CustomEvent('dooms:open-workshop', { detail: { characterName: persona.name, isUser: true } })); } catch (e) { /* no-op */ }
        }
    });
    $(document).on('click', '#' + CHIP_ID + ' .dooms-dice-chip-x', function (e) {
        e.stopPropagation();
        clearPendingCheck();
    });
    $(document).on('click', '#' + CHIP_ID, function () { openDicePanel(); });
    $(document).on('keydown.doomsDice', function (e) {
        if (e.key === 'Escape' && isOpen()) closeDicePanel();
    });
    window.addEventListener(DICE_CHANGED_EVENT, () => {
        updateChip();
        if (isOpen()) render();
    });
}
