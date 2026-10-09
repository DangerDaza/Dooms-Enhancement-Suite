/**
 * Dice panel — the "Roll a check" popover and the chip above the message box
 * (Project Short Fuse, Phase 2).
 *
 * Loaded on first use (dynamic import from the entry points), like the
 * other modals. The popover's markup lives in template.html; its body is
 * rendered from state here, and repainted on every DICE_CHANGED_EVENT, so
 * the game master's ruling shows up the moment it arrives.
 *
 * What the player decides here is the attribute. The difficulty and any
 * advantage are the game master's call (one small separate call made by
 * diceRolls.tagCheck); the override controls appear only with the setting
 * on. "Roll when I send" tags the message; "Roll now" tags it too, waits
 * for the ruling, rolls at once and shows the die.
 */
import { extensionSettings } from '../../core/state.js';
import { ensureSettingsUI } from '../../core/lazyUI.js';
import { escapeHtml } from '../../utils/html.js';
import { attributesConfig, attributeDefs, attributesOn, difficultyTable, formatModifier, modifier, formatRollShort } from '../../utils/d20.js';
import {
    DICE_CHANGED_EVENT,
    getPendingCheck,
    getPersonaSheet,
    tagCheck,
    reRateCheck,
    tagAndRollNow,
    overrideRuling,
    clearPendingCheck,
} from '../features/diceRolls.js';

const POPUP_ID = 'rpg-dice-popup';
const CHIP_ID = 'dooms-dice-chip';

let bound = false;
let lastAttributeId = null;     // the chip the player used last (session only)
let justRolled = null;          // the roll shown with the die animation, until closed
let rollingNow = false;         // a Roll now is waiting for the ruling

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
        justRolled = null;
        render();
        $popup.css('display', 'flex');
        setTimeout(() => { $('#rpg-dice-attempt').trigger('focus'); }, 30);
    }).catch(err => console.error('[Dooms Tracker] Dice panel failed to open:', err));
}

function closeDicePanel() {
    justRolled = null;
    rollingNow = false;
    $('#' + POPUP_ID).css('display', 'none');
}

function isOpen() {
    return $('#' + POPUP_ID).css('display') === 'flex';
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function selectedAttributeId(defs) {
    const pending = getPendingCheck();
    if (pending && defs.some(d => d.id === pending.attributeId)) return pending.attributeId;
    if (lastAttributeId && defs.some(d => d.id === lastAttributeId)) return lastAttributeId;
    return defs[0]?.id || null;
}

function rulingHtml(pending) {
    const cfg = attributesConfig(extensionSettings);
    if (!pending) {
        return `<p class="rpg-dice-hint">Pick an attribute and tag the message. The game master rates how hard the attempt is when you do${cfg.aiRatesDifficulty ? '' : ' (the AI is not asked; the default difficulty applies)'}.</p>`;
    }
    if (pending.rating) {
        return `<div class="rpg-dice-ruling is-waiting"><i class="fa-solid fa-circle-notch fa-spin"></i> Asking the game master how hard this is…</div>`;
    }
    const r = pending.ruling;
    if (!r) return '';
    const adv = r.advantage === 'adv' ? ' with <b>advantage</b>' : r.advantage === 'dis' ? ' with <b>disadvantage</b>' : '';
    let who;
    if (r.source === 'ai') who = 'The game master calls it';
    else if (r.source === 'override') who = 'You set it to';
    else who = r.error ? 'The game master could not be asked; the default is' : 'The default difficulty is';
    const reason = r.reason ? `<div class="rpg-dice-reason">“${escapeHtml(r.reason)}”</div>` : '';
    const again = pending.roll ? '' : `<button type="button" class="rpg-btn rpg-dice-reask" title="Ask again, with what the message box holds now"><i class="fa-solid fa-rotate"></i> Ask again</button>`;
    let override = '';
    if (cfg.allowOverride && !pending.roll) {
        const chips = difficultyTable(extensionSettings).map(d =>
            `<button type="button" class="rpg-dice-chip-btn rpg-dice-diff${d.id === r.difficultyId ? ' is-selected' : ''}" data-diff="${escapeHtml(d.id)}" title="DC ${d.dc}">${escapeHtml(d.label)} <small>${d.dc}</small></button>`).join('');
        const advSel = `<select class="rpg-dice-adv rpg-accordion-input" title="Advantage">
            <option value="none"${r.advantage === 'none' ? ' selected' : ''}>No advantage</option>
            <option value="adv"${r.advantage === 'adv' ? ' selected' : ''}>Advantage</option>
            <option value="dis"${r.advantage === 'dis' ? ' selected' : ''}>Disadvantage</option>
        </select>`;
        override = `<div class="rpg-dice-override"><span class="rpg-dice-override-label">Override:</span>${chips}${advSel}</div>`;
    }
    return `<div class="rpg-dice-ruling is-${escapeHtml(r.source || 'default')}">
        <div class="rpg-dice-ruling-line">${who} <b>${escapeHtml(r.label)}</b> (DC ${r.dc})${adv}. ${again}</div>
        ${reason}
        ${override}
    </div>`;
}

function dieHtml(roll) {
    const outcome = roll.critical === 'success' ? 'Critical success' : roll.critical === 'failure' ? 'Critical failure' : roll.success ? 'Success' : 'Failure';
    const cls = roll.success ? 'is-success' : 'is-failure';
    const pending = getPendingCheck();
    const where = pending && pending.roll === roll
        ? 'Rides with your next message.'
        : 'Attached to your last message. The reply will narrate it.';
    return `<div class="rpg-dice-result ${cls}${roll.critical ? ' is-crit' : ''}">
        <div class="rpg-dice-die" aria-hidden="true"><span>${roll.kept}</span></div>
        <div class="rpg-dice-result-text">
            <div class="rpg-dice-outcome">${escapeHtml(outcome)}</div>
            <div class="rpg-dice-math">${escapeHtml(formatRollShort(roll))}</div>
            <div class="rpg-dice-where">${escapeHtml(where)}</div>
        </div>
    </div>`;
}

function render() {
    const $body = $('#rpg-dice-body');
    if (!$body.length) return;
    if (!attributesOn(extensionSettings)) {
        $body.html('<p class="rpg-dice-hint">Attributes are off. Turn them on in <b>Settings → Stats → Attributes &amp; checks</b> to roll checks.</p>');
        return;
    }
    const defs = attributeDefs(extensionSettings);
    const persona = getPersonaSheet();
    const pending = getPendingCheck();
    const selected = selectedAttributeId(defs);
    const name = persona ? persona.name : 'You';

    const chips = defs.map(d => {
        const score = persona ? persona.sheet[d.id] : 10;
        const m = modifier(score);
        const sel = d.id === selected ? ' is-selected' : '';
        return `<button type="button" class="rpg-dice-chip-btn rpg-dice-attr${sel}" data-id="${escapeHtml(d.id)}" title="${escapeHtml(d.name)} ${score}">
            <span class="rpg-dice-attr-abbr">${escapeHtml(d.abbr)}</span>
            <span class="rpg-dice-attr-mod">${escapeHtml(formatModifier(m))}</span>
        </button>`;
    }).join('');

    const sheetNote = persona && persona.isDefault
        ? `<p class="rpg-dice-hint">${escapeHtml(name)}'s sheet is all 10s, so every check rolls at +0. <button type="button" class="rpg-link-btn rpg-dice-open-workshop">Set attributes in the Workshop</button></p>`
        : '';

    const attempt = pending ? pending.attempt : '';
    const rolled = justRolled || (pending && pending.roll) || null;

    let actions;
    if (rolled) {
        actions = `<div class="rpg-dice-actions">
            <button type="button" class="rpg-btn rpg-btn-primary rpg-dice-keep">Keep</button>
            ${pending && pending.roll === rolled ? '<button type="button" class="rpg-btn rpg-dice-discard">Discard</button>' : ''}
        </div>`;
    } else {
        const rating = !!(pending && pending.rating);
        const canRoll = !!selected && !rating && !rollingNow;
        const tagLabel = pending ? 'Re-tag with this attribute' : 'Roll when I send';
        const rollLabel = rollingNow ? 'Asking the game master…' : 'Roll now';
        const rollTitle = rating || rollingNow ? "Waiting for the game master's ruling" : 'Ask the game master, roll at once and see the die';
        actions = `<div class="rpg-dice-actions">
            <button type="button" class="rpg-btn rpg-btn-primary rpg-dice-tag"${rollingNow ? ' disabled' : ''} title="Tag the message you are writing; the roll happens when you send it">${tagLabel}</button>
            <button type="button" class="rpg-btn rpg-dice-roll-now"${canRoll ? '' : ' disabled'} title="${rollTitle}">${rollLabel}</button>
            ${pending ? '<button type="button" class="rpg-btn rpg-dice-discard">Discard</button>' : ''}
        </div>`;
    }

    $body.html(`
        <div class="rpg-dice-who">Checking as <b>${escapeHtml(name)}</b></div>
        <div class="rpg-dice-attrs">${chips}</div>
        ${sheetNote}
        <label class="rpg-dice-attempt-label">What are you attempting?
            <input type="text" id="rpg-dice-attempt" class="rpg-accordion-input" maxlength="300"
                value="${escapeHtml(attempt)}" placeholder="Optional. Empty uses the message box text." />
        </label>
        ${rulingHtml(pending)}
        ${rolled ? dieHtml(rolled) : ''}
        ${actions}
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
    let text;
    if (pending.roll) {
        text = `🎲 ${formatRollShort(pending.roll)} · rides with your next message`;
    } else if (pending.rating) {
        text = `🎲 ${pending.abbr} check · asking the game master…`;
    } else if (pending.ruling) {
        const r = pending.ruling;
        const adv = r.advantage === 'adv' ? ', advantage' : r.advantage === 'dis' ? ', disadvantage' : '';
        text = `🎲 ${pending.abbr} check · ${r.label} (DC ${r.dc})${adv} · rolls when you send`;
    } else {
        text = `🎲 ${pending.abbr} check · rolls when you send`;
    }
    $chip.find('.dooms-dice-chip-text').text(text);
    $chip.show();
}

// ─── Events ─────────────────────────────────────────────────────────────────

function bindOnce() {
    if (bound) return;
    bound = true;
    $(document).on('click', '#rpg-dice-close', closeDicePanel);
    $(document).on('click', '#rpg-dice-body .rpg-dice-attr', function () {
        lastAttributeId = String($(this).data('id'));
        const pending = getPendingCheck();
        if (pending && !pending.roll && pending.attributeId !== lastAttributeId) {
            // A different attribute is a different check: re-tag at once.
            tagCheck({ attributeId: lastAttributeId, attempt: String($('#rpg-dice-attempt').val() || '') });
        }
        render();
    });
    $(document).on('click', '#rpg-dice-body .rpg-dice-tag', function () {
        const defs = attributeDefs(extensionSettings);
        const id = selectedAttributeId(defs);
        if (!id) return;
        lastAttributeId = id;
        justRolled = null;
        tagCheck({ attributeId: id, attempt: String($('#rpg-dice-attempt').val() || '') });
        render();
    });
    $(document).on('keydown', '#rpg-dice-attempt', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); $('#rpg-dice-body .rpg-dice-tag').trigger('click'); }
    });
    $(document).on('click', '#rpg-dice-body .rpg-dice-reask', function () {
        const pending = getPendingCheck();
        if (!pending) return;
        pending.attempt = String($('#rpg-dice-attempt').val() || '').trim().slice(0, 300) || pending.attempt;
        reRateCheck();
    });
    $(document).on('click', '#rpg-dice-body .rpg-dice-diff', function () {
        const pending = getPendingCheck();
        overrideRuling({ difficultyId: String($(this).data('diff')), advantage: pending?.ruling?.advantage || 'none' });
    });
    $(document).on('change', '#rpg-dice-body .rpg-dice-adv', function () {
        const pending = getPendingCheck();
        overrideRuling({ difficultyId: pending?.ruling?.difficultyId, advantage: String($(this).val()) });
    });
    $(document).on('click', '#rpg-dice-body .rpg-dice-roll-now', async function () {
        if (rollingNow) return;
        const defs = attributeDefs(extensionSettings);
        const id = selectedAttributeId(defs);
        if (!id) return;
        lastAttributeId = id;
        justRolled = null;
        rollingNow = true;
        render();
        let roll = null;
        try {
            roll = await tagAndRollNow({ attributeId: id, attempt: String($('#rpg-dice-attempt').val() || '') });
        } catch (e) {
            console.error('[Dooms Tracker] Dice: Roll now failed', e);
        }
        rollingNow = false;
        if (roll) justRolled = roll;
        if (isOpen()) render();
    });
    $(document).on('click', '#rpg-dice-body .rpg-dice-keep', closeDicePanel);
    $(document).on('click', '#rpg-dice-body .rpg-dice-discard', function () {
        justRolled = null;
        clearPendingCheck();
        render();
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
        if (isOpen()) {
            // A roll that just attached on send is no longer "just rolled".
            if (justRolled && !getPendingCheck()) justRolled = null;
            render();
        }
    });
}
