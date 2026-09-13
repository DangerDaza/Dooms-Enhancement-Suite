/**
 * Generation Relay — settings section ("Phone & Reliability") and the
 * Recovered Generations tray modal. Markup lives in template.html
 * (#rpg-relay-tray-popup, data-accordion="relay").
 */
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { escapeHtml } from '../../utils/html.js';
import {
    getRelayConnection,
    onRelayStatus,
    probeRelay,
    setRelayEnabled,
} from './relayClient.js';
import {
    getTrayItems,
    onTrayChange,
    dismissTrayItem,
    insertTrayItemIntoInput,
    addTrayItemAsReply,
    scanRelayJobs,
    setTrayOpener,
} from './relayRecovery.js';

let initialized = false;

/* ------------------------------------------------------------------ */
/* settings section                                                    */
/* ------------------------------------------------------------------ */

function describe(connection) {
    switch (connection.state) {
        case 'connected':
            return { cls: 'is-ok', icon: 'fa-circle-check', text: `Relay plugin connected (v${connection.info?.version || '?'}). Replies keep generating on the server when this device locks or loses the tunnel.` };
        case 'disabled':
            return { cls: 'is-off', icon: 'fa-circle-minus', text: 'Relay is switched off. Generations go straight from this device to the API.' };
        case 'missing':
            return { cls: 'is-missing', icon: 'fa-triangle-exclamation', text: `Relay plugin not reachable (${connection.error || 'not installed'}). Install it on the server (see below) and re-check.` };
        default:
            return { cls: '', icon: 'fa-circle-question', text: 'Checking for the relay plugin…' };
    }
}

function renderStatus(connection = getRelayConnection()) {
    const $status = $('#rpg-relay-status');
    if (!$status.length) return;
    const { cls, icon, text } = describe(connection);
    $status.attr('class', `rpg-relay-status ${cls}`).html(`<i class="fa-solid ${icon}" aria-hidden="true"></i> <span>${escapeHtml(text)}</span>`);
    const enabled = extensionSettings.relay?.enabled !== false;
    $('#rpg-relay-badge').text(!enabled ? 'off' : connection.state === 'connected' ? 'on' : 'no plugin');
}

export function refreshRelaySettingsUI() {
    const relay = extensionSettings.relay || {};
    $('#rpg-toggle-relay').prop('checked', relay.enabled !== false);
    $('#rpg-toggle-relay-wakelock').prop('checked', relay.wakeLock !== false);
    renderStatus();
    renderTrayCount(getTrayItems());
}

/* ------------------------------------------------------------------ */
/* tray                                                                */
/* ------------------------------------------------------------------ */

function renderTrayCount(items) {
    const n = items.length;
    const $count = $('#rpg-relay-tray-count');
    $count.text(String(n)).prop('hidden', n === 0);
    $('#rpg-open-relay-tray').toggleClass('has-items', n > 0);
}

function when(ts) {
    if (!ts) return '';
    try {
        return new Date(ts).toLocaleString();
    } catch {
        return '';
    }
}

function renderTray(items = getTrayItems()) {
    const $entries = $('#rpg-relay-tray-popup .rpg-relay-tray-entries');
    if (!$entries.length) return;
    if (!items.length) {
        $entries.html('<div class="rpg-log-empty">Nothing waiting. Generations that finish while this device is away show up here when they cannot be put straight into the chat.</div>');
        return;
    }
    const html = items.map((item) => {
        const head = `<span class="rpg-relay-entry-kind">${escapeHtml(item.label || item.kind)}</span><span class="rpg-relay-entry-time">${escapeHtml(when(item.endedAt || item.startedAt))}</span>`;
        if (item.running) {
            return `<div class="rpg-relay-entry is-running" data-id="${escapeHtml(item.id)}">
                <div class="rpg-relay-entry-head">${head}</div>
                <div class="rpg-relay-entry-text"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Still generating on the server — it will be applied when it finishes.</div>
                <div class="rpg-relay-entry-actions">
                    <button type="button" class="rpg-accordion-action-btn rpg-btn-danger" data-act="dismiss"><i class="fa-solid fa-stop"></i> Stop &amp; discard</button>
                </div>
            </div>`;
        }
        const error = item.error ? `<div class="rpg-relay-entry-error"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${escapeHtml(item.error)}</div>` : '';
        const reason = item.reason === 'conflict'
            ? '<div class="rpg-relay-entry-note">The chat changed since this was requested, so it was not added automatically.</div>'
            : '';
        const text = item.text ? `<div class="rpg-relay-entry-text">${escapeHtml(item.text)}</div>` : '';
        const canAdd = item.text ? '<button type="button" class="rpg-accordion-action-btn" data-act="reply"><i class="fa-solid fa-comment"></i> Add as reply</button>' : '';
        const canInsert = item.text ? '<button type="button" class="rpg-accordion-action-btn" data-act="insert"><i class="fa-solid fa-keyboard"></i> Put in input box</button>' : '';
        const canCopy = item.text ? '<button type="button" class="rpg-accordion-action-btn" data-act="copy"><i class="fa-solid fa-copy"></i> Copy</button>' : '';
        return `<div class="rpg-relay-entry" data-id="${escapeHtml(item.id)}">
            <div class="rpg-relay-entry-head">${head}</div>
            ${error}${reason}${text}
            <div class="rpg-relay-entry-actions">
                ${canAdd}${canInsert}${canCopy}
                <button type="button" class="rpg-accordion-action-btn rpg-btn-danger" data-act="dismiss"><i class="fa-solid fa-trash"></i> Dismiss</button>
            </div>
        </div>`;
    }).join('');
    $entries.html(html);
}

export function openRelayTray() {
    const $modal = $('#rpg-relay-tray-popup');
    if (!$modal.length) return;
    renderTray();
    $modal.css('display', 'flex');
    scanRelayJobs('tray');
}

function closeRelayTray() {
    $('#rpg-relay-tray-popup').css('display', 'none');
}

async function onTrayAction(event) {
    const $btn = $(event.currentTarget);
    const id = $btn.closest('.rpg-relay-entry').data('id');
    const act = $btn.data('act');
    if (!id || !act) return;
    $btn.prop('disabled', true);
    try {
        switch (act) {
            case 'dismiss':
                await dismissTrayItem(id);
                break;
            case 'insert':
                if (await insertTrayItemIntoInput(id)) toastr.info('Text placed in the input box.', 'Generation Relay', { timeOut: 2500 });
                break;
            case 'reply':
                if (await addTrayItemAsReply(id)) toastr.success('Added to the chat.', 'Generation Relay', { timeOut: 2500 });
                else toastr.warning('Open the chat this reply belongs to first.', 'Generation Relay', { timeOut: 4000 });
                break;
            case 'copy': {
                const item = getTrayItems().find(i => i.id === id);
                if (item?.text && navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(item.text);
                    toastr.info('Copied.', 'Generation Relay', { timeOut: 1500 });
                }
                break;
            }
        }
    } catch (e) {
        console.warn('[DES Relay] tray action failed', e);
        toastr.error(e?.message || String(e), 'Generation Relay');
    } finally {
        $btn.prop('disabled', false);
    }
}

/* ------------------------------------------------------------------ */
/* init                                                                */
/* ------------------------------------------------------------------ */

export function initRelayUI() {
    if (initialized) return;
    initialized = true;

    $(document).on('change', '#rpg-toggle-relay', async function () {
        await setRelayEnabled($(this).prop('checked'));
        saveSettings();
        renderStatus();
        if (extensionSettings.relay?.enabled !== false) scanRelayJobs('enabled');
    });
    $(document).on('change', '#rpg-toggle-relay-wakelock', function () {
        if (!extensionSettings.relay || typeof extensionSettings.relay !== 'object') extensionSettings.relay = {};
        extensionSettings.relay.wakeLock = $(this).prop('checked');
        saveSettings();
    });
    $(document).on('click', '#rpg-relay-recheck', async function () {
        const $btn = $(this).prop('disabled', true);
        try {
            const c = await probeRelay({ force: true });
            renderStatus(c);
            if (c.state === 'connected') scanRelayJobs('recheck');
        } finally {
            $btn.prop('disabled', false);
        }
    });
    $(document).on('click', '#rpg-open-relay-tray, #rpg-relay-tray-refresh', function () {
        if (this.id === 'rpg-relay-tray-refresh') {
            scanRelayJobs('tray').then(() => renderTray());
            return;
        }
        openRelayTray();
    });
    $(document).on('click', '#rpg-close-relay-tray', closeRelayTray);
    $(document).on('click', '#rpg-relay-tray-popup .rpg-relay-entry button[data-act]', onTrayAction);

    onRelayStatus(renderStatus);
    onTrayChange((items) => {
        renderTrayCount(items);
        if ($('#rpg-relay-tray-popup').is(':visible')) renderTray(items);
    });
    setTrayOpener(openRelayTray);
    refreshRelaySettingsUI();
}
