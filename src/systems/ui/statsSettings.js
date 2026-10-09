/**
 * Settings → Stats: one row per built-in stat with an on/off switch and, for
 * the ring stats, a colour. Both apply to every character (see
 * characterStats.setStatEnabled / setStatColor). The Workshop's Stats tab
 * edits the same settings, so this list repaints on STATS_CHANGED_EVENT.
 */
import { escapeHtml } from '../../utils/html.js';
import { builtinStatList, isHexColor, CUSTOM_STATE_COLORS } from '../../utils/statsModel.js';
import {
    getDisabledStatIds,
    setStatEnabled,
    getStatColors,
    setStatColor,
    STATS_CHANGED_EVENT,
    getCustomStatDefinitions,
    deleteCustomStat,
} from '../features/characterStats.js';
import { setMemoriesEnabled, getRecentLimit, setRecentLimit } from '../features/characterMemories.js';
import { setEquipmentEnabled } from '../features/characterEquipment.js';
import { setConditionsEnabled } from '../features/characterConditions.js';
import { setAbilitiesEnabled } from '../features/characterAbilities.js';
import { extensionSettings } from '../../core/state.js';
import {
    RPG_MODE_CHANGED_EVENT,
    isRpgModeActive,
    rpgModeSource,
    getChatRpgMode,
    getCardRpgMode,
    getDefaultRpgMode,
    setChatRpgMode,
    setCardRpgMode,
    setDefaultRpgMode,
    currentCardKey,
    currentCardName,
} from '../features/rpgMode.js';
import { getXpSettings, setXpSetting, setLevelsEnabled, setXpEnabled } from '../features/characterProgress.js';
import { XP_SIZES } from '../../utils/xpModel.js';

function sixDigit(color) {
    const c = String(color || '');
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map(ch => ch + ch).join('').toLowerCase();
    return '#888888';
}

function rowHtml(stat, on, colors) {
    const id = `rpg-stat-toggle-${stat.id}`;
    const custom = isHexColor(colors[stat.id]);
    const color = custom ? colors[stat.id] : stat.color;
    const tag = stat.kind === 'state'
        ? `<label class="rpg-stat-color-swatch" title="Change the colour of ${escapeHtml(stat.name)}" style="background:${escapeHtml(color || '#888')}">
                <input type="color" class="rpg-stat-color" data-stat="${escapeHtml(stat.id)}" value="${escapeHtml(sixDigit(color))}" aria-label="${escapeHtml(stat.name)} colour">
           </label>`
        : `<span class="rpg-stat-toggle-abbr">${escapeHtml(stat.abbr || '')}</span>`;
    const reset = stat.kind === 'state' && custom && stat.builtin !== false
        ? `<button type="button" class="rpg-stat-color-reset" data-stat="${escapeHtml(stat.id)}" title="Back to the default colour"><i class="fa-solid fa-rotate-left"></i></button>`
        : '';
    const del = stat.builtin === false
        ? `<button type="button" class="rpg-stat-delete" data-stat="${escapeHtml(stat.id)}" data-name="${escapeHtml(stat.name)}" title="Delete ${escapeHtml(stat.name)} for every character"><i class="fa-solid fa-trash"></i></button>`
        : '';
    return `
        <div class="rpg-setting-row rpg-stat-setting-row${on ? '' : ' is-off'}">
            <div class="rpg-setting-label-group">
                <span class="rpg-setting-label">${tag}${escapeHtml(stat.name)}${stat.builtin === false ? ` <span class="rpg-stat-kind">${stat.kind === 'state' ? 'stat' : 'attribute'}</span>` : ''}${reset}${del}</span>
                <span class="rpg-setting-hint">${escapeHtml(stat.description || '')}</span>
            </div>
            <label class="rpg-toggle-switch" for="${id}" title="Use ${escapeHtml(stat.name)}">
                <input type="checkbox" id="${id}" class="rpg-stat-toggle" data-stat="${escapeHtml(stat.id)}"${on ? ' checked' : ''} />
                <span class="rpg-toggle-slider"></span>
            </label>
        </div>`;
}

/** Fills the two lists from the current settings. Safe to call again. */
export function renderStatsSettings() {
    const off = new Set(getDisabledStatIds());
    const colors = getStatColors();
    const all = builtinStatList();
    const states = document.getElementById('rpg-stats-toggle-states');
    const attrs = document.getElementById('rpg-stats-toggle-attributes');
    if (states) states.innerHTML = all.filter(s => s.kind === 'state').map(s => rowHtml(s, !off.has(s.id), colors)).join('');
    if (attrs) attrs.innerHTML = all.filter(s => s.kind === 'attribute').map(s => rowHtml(s, !off.has(s.id), colors)).join('');
    const customHost = document.getElementById('rpg-stats-toggle-custom');
    if (customHost) {
        let i = 0;
        const defs = getCustomStatDefinitions().map(d => ({
            ...d,
            builtin: false,
            abbr: d.kind === 'attribute' ? String(d.name || '').slice(0, 3).toUpperCase() : '',
            color: d.color || (d.kind === 'state' ? CUSTOM_STATE_COLORS[i++ % CUSTOM_STATE_COLORS.length] : ''),
        }));
        customHost.innerHTML = defs.length
            ? defs.map(s => rowHtml(s, !off.has(s.id), colors)).join('')
            : '<p class="rpg-note-text">None yet — add them from the Stats tab of any character in the Workshop.</p>';
    }
}

let bound = false;

/** Renders the rows and wires them up (once). */
export function initStatsSettings() {
    renderStatsSettings();
    // The switches show the feature's own setting (RPG mode is shown apart).
    const flag = (id, key) => { const el = document.getElementById(id); if (el) el.checked = extensionSettings[key] !== false; };
    flag('rpg-abilities-enabled', 'characterAbilitiesEnabled');
    flag('rpg-conditions-enabled', 'characterConditionsEnabled');
    flag('rpg-equipment-enabled', 'characterEquipmentEnabled');
    flag('rpg-memories-enabled', 'characterMemoriesEnabled');
    flag('rpg-levels-enabled', 'characterLevelsEnabled');
    flag('rpg-xp-enabled', 'characterXpEnabled');
    const memRecent = document.getElementById('rpg-memories-recent');
    if (memRecent) memRecent.value = String(getRecentLimit());
    renderXpSettings();
    renderRpgModeSettings();
    if (bound) return;
    bound = true;
    document.addEventListener('change', (e) => {
        const el = e.target;
        if (!el || !el.classList) return;
        if (el.classList.contains('rpg-stat-toggle')) setStatEnabled(el.getAttribute('data-stat'), el.checked);
        else if (el.classList.contains('rpg-stat-color')) setStatColor(el.getAttribute('data-stat'), el.value);
        else if (el.id === 'rpg-equipment-enabled') setEquipmentEnabled(el.checked);
        else if (el.id === 'rpg-conditions-enabled') setConditionsEnabled(el.checked);
        else if (el.id === 'rpg-abilities-enabled') setAbilitiesEnabled(el.checked);
        else if (el.id === 'rpg-memories-enabled') setMemoriesEnabled(el.checked);
        else if (el.id === 'rpg-memories-recent') { setRecentLimit(el.value); el.value = String(getRecentLimit()); }
        else if (el.id === 'rpg-levels-enabled') setLevelsEnabled(el.checked);
        else if (el.id === 'rpg-xp-enabled') setXpEnabled(el.checked);
        else if (el.id === 'rpg-xp-per-level') { setXpSetting('perLevel', el.value); renderXpSettings(); }
        else if (el.id === 'rpg-xp-points') { setXpSetting('pointsPerLevel', el.value); renderXpSettings(); }
        else if (el.id === 'rpg-xp-quest-main') setXpSetting('questMain', el.value);
        else if (el.id === 'rpg-xp-quest-optional') setXpSetting('questOptional', el.value);
        else if (el.id && el.id.startsWith('rpg-xp-') && XP_SIZES.includes(el.id.slice(7))) { setXpSetting(el.id.slice(7), el.value); renderXpSettings(); }
        else if (el.id === 'rpg-mode-default') setDefaultRpgMode(el.checked);
        else if (el.id === 'rpg-mode-card') setCardRpgMode(el.value === 'on' ? true : el.value === 'off' ? false : null);
        else if (el.id === 'rpg-mode-chat') setChatRpgMode(el.value === 'on' ? true : el.value === 'off' ? false : null);
    });
    document.addEventListener('input', (e) => {
        const el = e.target;
        if (el && el.classList && el.classList.contains('rpg-stat-color')) {
            el.parentElement.style.background = el.value;
        }
    });
    document.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('.rpg-stat-color-reset') : null;
        if (btn) { e.preventDefault(); setStatColor(btn.getAttribute('data-stat'), ''); return; }
        const del = e.target && e.target.closest ? e.target.closest('.rpg-stat-delete') : null;
        if (del) {
            e.preventDefault();
            const name = del.getAttribute('data-name') || 'this stat';
            if (window.confirm(`Delete the stat "${name}" for every character?\n\nTheir values for it are deleted too.`)) {
                deleteCustomStat(del.getAttribute('data-stat'));
            }
        }
    });
    window.addEventListener(RPG_MODE_CHANGED_EVENT, () => renderRpgModeSettings());
    // Changes made from the Workshop (or a reset here) repaint the list.
    window.addEventListener(STATS_CHANGED_EVENT, (e) => {
        if (e.detail?.source !== 'settings') return;
        const active = document.activeElement;
        if (active && active.classList && active.classList.contains('rpg-stat-color')) return;
        renderStatsSettings();
    });
}

/** The XP amounts, curve and quest sizes. */
export function renderXpSettings() {
    const x = getXpSettings();
    const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = String(v); };
    for (const size of XP_SIZES) set(`rpg-xp-${size}`, x.tiers[size]);
    set('rpg-xp-per-level', x.perLevel);
    set('rpg-xp-points', x.pointsPerLevel);
    set('rpg-xp-quest-main', x.questMain);
    set('rpg-xp-quest-optional', x.questOptional);
    const hint = document.getElementById('rpg-xp-curve-hint');
    if (hint) {
        const p = x.perLevel;
        hint.textContent = `Level × this amount to reach the next one: level 2 at ${p} XP, level 3 at ${p * 3}, level 4 at ${p * 6}…`;
    }
}

/** The three RPG mode controls, for the chat and card open now. */
export function renderRpgModeSettings() {
    const def = document.getElementById('rpg-mode-default');
    if (def) def.checked = getDefaultRpgMode();
    const val = (v) => (v === true ? 'on' : v === false ? 'off' : '');
    const card = document.getElementById('rpg-mode-card');
    const hasCard = !!currentCardKey();
    if (card) {
        card.value = val(getCardRpgMode());
        card.disabled = !hasCard;
    }
    const cardName = document.getElementById('rpg-mode-card-name');
    if (cardName) cardName.textContent = hasCard && currentCardName() ? ` (${currentCardName()})` : '';
    const chatSel = document.getElementById('rpg-mode-chat');
    if (chatSel) chatSel.value = val(getChatRpgMode());
    const status = document.getElementById('rpg-mode-status');
    if (status) {
        const from = { chat: 'set for this chat', card: 'set for this card', default: 'the default' }[rpgModeSource()];
        status.textContent = `RPG mode is ${isRpgModeActive() ? 'ON' : 'OFF'} here (${from}).`;
    }
}
