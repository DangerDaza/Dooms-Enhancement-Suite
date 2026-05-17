/**
 * Context Inspector Modal — surfaces every DES injection so the user can
 * see, verbatim, what's queued for the next generation and what was sent
 * to the model in past generations.
 *
 * Two tabs:
 *   - Live Snapshot: current state of every DES setExtensionPrompt slot.
 *     Opening this between turns shows what's queued for the next send
 *     (most useful for the Character Workshop "inject into scene" flow).
 *   - History: rolling per-generation log (last 25) with slot writes,
 *     in-flight event mutations (historical context append, <context>
 *     newline fixup, suppression clears), and the separate-mode tracker
 *     prompt if any.
 *
 * Pure observation — opening or closing the modal never touches state.
 */
import {
    getCurrentSlots,
    getGenerationLog,
    clearGenerationLog,
    snapshot,
} from '../generation/inspector.js';

const MODAL_ID = 'rpg-inspector-popup';

const POSITION_LABELS = {
    0: 'IN_PROMPT (system)',
    1: 'IN_CHAT',
    2: 'BEFORE_PROMPT',
    3: 'NONE',
};
const ROLE_LABELS = {
    0: 'system',
    1: 'user',
    2: 'assistant',
};

let _initialized = false;
let _currentTab = 'live';

export function initInspectorModal() {
    if (_initialized) return;
    _initialized = true;

    // Bind both the settings-panel entry button and the modal's own controls
    // via delegation so the modal HTML can be loaded after init.
    $(document).on('click', '#rpg-open-inspector', openInspectorModal);
    $(document).on('click', '#rpg-close-inspector', closeInspectorModal);
    $(document).on('click', '#rpg-inspector-refresh', renderModalBody);
    $(document).on('click', '#rpg-inspector-copy-all', copyAllAsJson);
    $(document).on('click', '#rpg-inspector-clear-log', () => {
        clearGenerationLog();
        renderModalBody();
        try { toastr.info('Generation log cleared.', '', { timeOut: 1500 }); } catch {}
    });
    $(document).on('click', '.rpg-inspector-tab', function () {
        const tab = $(this).data('tab');
        if (tab) {
            _currentTab = tab;
            renderModalBody();
        }
    });
    $(document).on('click', '.rpg-inspector-copy-btn', function () {
        const payload = $(this).attr('data-payload');
        if (payload == null) return;
        const text = decodeURIComponent(payload);
        navigator.clipboard.writeText(text).then(() => {
            try { toastr.success('Copied.', '', { timeOut: 1200 }); } catch {}
        }).catch(() => {
            try { toastr.error('Copy failed.', '', { timeOut: 1500 }); } catch {}
        });
    });
    $(document).on('click', '.rpg-inspector-card-toggle', function () {
        const $card = $(this).closest('.rpg-inspector-card');
        $card.toggleClass('collapsed');
    });

    console.log('[Dooms Tracker] Inspector Modal initialized');
}

export function openInspectorModal() {
    const $modal = $('#' + MODAL_ID);
    if (!$modal.length) {
        console.warn('[Dooms Tracker] Inspector modal element not found — template not loaded?');
        return;
    }
    renderModalBody();
    $modal.css('display', 'flex');
}

function closeInspectorModal() {
    $('#' + MODAL_ID).css('display', 'none');
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderModalBody() {
    const $body = $('#' + MODAL_ID + ' .rpg-inspector-body');
    if (!$body.length) return;

    // Tab buttons
    const $tabs = $('#' + MODAL_ID + ' .rpg-inspector-tabs');
    $tabs.find('.rpg-inspector-tab').each(function () {
        const isActive = $(this).data('tab') === _currentTab;
        $(this).toggleClass('active', isActive);
    });

    if (_currentTab === 'live') {
        $body.html(renderLiveSnapshot());
    } else {
        $body.html(renderHistory());
    }
}

function renderLiveSnapshot() {
    const slots = getCurrentSlots();
    // Sort: populated first, then empty
    slots.sort((a, b) => {
        const aPop = (a.content || '').length > 0 ? 0 : 1;
        const bPop = (b.content || '').length > 0 ? 0 : 1;
        if (aPop !== bPop) return aPop - bPop;
        return a.label.localeCompare(b.label);
    });

    const populated = slots.filter(s => (s.content || '').length > 0);
    const empty = slots.filter(s => !(s.content || '').length);

    let html = `
        <div class="rpg-inspector-summary">
            <strong>${populated.length}</strong> slot${populated.length === 1 ? '' : 's'} queued,
            <strong>${empty.length}</strong> empty.
            Opens between turns reflect what will go out on the next send.
            Live event-hook mutations (historical context append, &lt;context&gt; newline fixup)
            are computed mid-generation — see the <a href="#" class="rpg-inspector-tab-link" data-tab="history">History</a> tab after sending.
        </div>
    `;

    if (populated.length === 0) {
        html += `<div class="rpg-inspector-empty">No DES slots currently populated. Send a message, or use the Workshop "Inject into Scene" action, to queue content.</div>`;
    }

    // Populated cards first
    for (const slot of populated) {
        html += renderSlotCard(slot, /*defaultCollapsed*/ false);
    }
    if (empty.length > 0) {
        html += `<div class="rpg-inspector-divider">Empty slots (${empty.length})</div>`;
        for (const slot of empty) {
            html += renderSlotCard(slot, /*defaultCollapsed*/ true);
        }
    }
    return html;
}

function renderSlotCard(slot, defaultCollapsed) {
    const isEmpty = !(slot.content || '').length;
    const stateBadge = isEmpty
        ? `<span class="rpg-inspector-badge rpg-inspector-badge-empty">empty</span>`
        : `<span class="rpg-inspector-badge rpg-inspector-badge-active">QUEUED · ${slot.content.length} chars</span>`;
    const sourceBadge = `<span class="rpg-inspector-badge rpg-inspector-badge-source-${slot.source}">${slot.source}</span>`;
    const lastWrite = slot.lastWriteAt ? new Date(slot.lastWriteAt).toLocaleTimeString() : '(never written)';
    const position = POSITION_LABELS[slot.position] ?? `pos=${slot.position}`;
    const role = slot.role !== undefined ? `, role=${ROLE_LABELS[slot.role] ?? slot.role}` : '';
    const collapsed = defaultCollapsed ? ' collapsed' : '';
    const contentHtml = isEmpty
        ? `<div class="rpg-inspector-content-empty">(slot is empty — not currently injected)</div>`
        : `<pre class="rpg-inspector-content">${escapeHtml(slot.content)}</pre>`;
    const copyPayload = encodeURIComponent(slot.content || '');
    const copyBtn = isEmpty ? '' : `<button class="rpg-inspector-copy-btn" data-payload="${copyPayload}" type="button" title="Copy content"><i class="fa-solid fa-copy"></i> Copy</button>`;

    return `
        <div class="rpg-inspector-card${collapsed}">
            <div class="rpg-inspector-card-head rpg-inspector-card-toggle">
                <div class="rpg-inspector-card-title">
                    <i class="fa-solid fa-chevron-right rpg-inspector-chevron"></i>
                    <strong>${escapeHtml(slot.label)}</strong>
                    ${sourceBadge}
                    ${stateBadge}
                </div>
                <div class="rpg-inspector-card-meta">
                    <code>${escapeHtml(slot.slot)}</code>
                    · ${position}
                    · depth=${slot.depth}${role}
                    · last write ${lastWrite}
                </div>
            </div>
            <div class="rpg-inspector-card-body">
                <div class="rpg-inspector-feature">Feature: ${escapeHtml(slot.feature)}</div>
                ${contentHtml}
                ${copyBtn}
            </div>
        </div>
    `;
}

function renderHistory() {
    const log = getGenerationLog();
    let html = `
        <div class="rpg-inspector-summary">
            ${log.length} generation${log.length === 1 ? '' : 's'} captured (rolling, max 25).
            Newest first. Includes slot writes, in-flight event mutations, and the
            separate-mode tracker prompt where applicable.
        </div>
    `;
    if (log.length === 0) {
        html += `<div class="rpg-inspector-empty">No generations captured yet. Send a message to populate this log.</div>`;
        return html;
    }
    // Newest first
    for (let i = log.length - 1; i >= 0; i--) {
        html += renderGenerationCard(log[i], i === log.length - 1);
    }
    return html;
}

function renderGenerationCard(rec, isMostRecent) {
    const start = new Date(rec.startedAt).toLocaleTimeString();
    const dur = rec.endedAt ? `${rec.endedAt - rec.startedAt}ms` : 'in-flight';
    const typeBadge = rec.type ? `<span class="rpg-inspector-badge rpg-inspector-badge-source-injector">type=${escapeHtml(rec.type)}</span>` : '';
    const dryBadge = rec.dryRun ? `<span class="rpg-inspector-badge">dryRun</span>` : '';
    const collapsed = isMostRecent ? '' : ' collapsed';

    const slotWriteCount = rec.slotWrites.length;
    const mutationCount = rec.eventMutations.length;
    const hasSeparate = !!rec.separateTrackerPrompt;
    const summaryBits = [
        `${slotWriteCount} slot write${slotWriteCount === 1 ? '' : 's'}`,
        `${mutationCount} event mutation${mutationCount === 1 ? '' : 's'}`,
    ];
    if (hasSeparate) summaryBits.push('+ separate tracker prompt');

    let body = '';

    if (slotWriteCount > 0) {
        body += `<h4 class="rpg-inspector-section-title">Slot writes</h4>`;
        for (const sw of rec.slotWrites) {
            body += renderSlotWriteEntry(sw);
        }
    }
    if (mutationCount > 0) {
        body += `<h4 class="rpg-inspector-section-title">Event mutations</h4>`;
        for (const m of rec.eventMutations) {
            body += renderEventMutation(m);
        }
    }
    if (hasSeparate) {
        body += `<h4 class="rpg-inspector-section-title">Separate-mode tracker prompt</h4>`;
        const copyPayload = encodeURIComponent(rec.separateTrackerPrompt);
        body += `
            <pre class="rpg-inspector-content">${escapeHtml(rec.separateTrackerPrompt)}</pre>
            <button class="rpg-inspector-copy-btn" data-payload="${copyPayload}" type="button" title="Copy"><i class="fa-solid fa-copy"></i> Copy</button>
        `;
    }
    if (!body) {
        body = '<div class="rpg-inspector-empty">No captures recorded for this generation.</div>';
    }

    return `
        <div class="rpg-inspector-card${collapsed}">
            <div class="rpg-inspector-card-head rpg-inspector-card-toggle">
                <div class="rpg-inspector-card-title">
                    <i class="fa-solid fa-chevron-right rpg-inspector-chevron"></i>
                    <strong>Gen #${rec.id}</strong>
                    ${typeBadge}
                    ${dryBadge}
                </div>
                <div class="rpg-inspector-card-meta">
                    started ${start} · ${dur} · ${summaryBits.join(' · ')}
                </div>
            </div>
            <div class="rpg-inspector-card-body">
                ${body}
            </div>
        </div>
    `;
}

function renderSlotWriteEntry(sw) {
    const isClear = !(sw.content || '').length;
    const wasPopulated = !!(sw.previousContent && sw.previousContent.length);
    let stateBadge;
    if (isClear && wasPopulated) {
        stateBadge = `<span class="rpg-inspector-badge rpg-inspector-badge-cleared">CLEARED (was ${sw.previousContent.length} chars)</span>`;
    } else if (isClear) {
        stateBadge = `<span class="rpg-inspector-badge rpg-inspector-badge-empty">cleared (already empty)</span>`;
    } else if (wasPopulated && sw.content !== sw.previousContent) {
        stateBadge = `<span class="rpg-inspector-badge rpg-inspector-badge-active">REPLACED · ${sw.content.length} chars (was ${sw.previousContent.length})</span>`;
    } else if (wasPopulated) {
        stateBadge = `<span class="rpg-inspector-badge rpg-inspector-badge-active">REWRITTEN (identical) · ${sw.content.length} chars</span>`;
    } else {
        stateBadge = `<span class="rpg-inspector-badge rpg-inspector-badge-active">QUEUED · ${sw.content.length} chars</span>`;
    }
    const sourceBadge = `<span class="rpg-inspector-badge rpg-inspector-badge-source-${sw.source}">${sw.source}</span>`;
    const position = POSITION_LABELS[sw.position] ?? `pos=${sw.position}`;
    const role = sw.role !== undefined ? `, role=${ROLE_LABELS[sw.role] ?? sw.role}` : '';
    const ts = new Date(sw.timestamp).toLocaleTimeString();
    const contentHtml = isClear
        ? `<div class="rpg-inspector-content-empty">(cleared — empty content written)</div>`
        : `<pre class="rpg-inspector-content">${escapeHtml(sw.content)}</pre>`;
    const copyPayload = encodeURIComponent(sw.content || '');
    const copyBtn = isClear ? '' : `<button class="rpg-inspector-copy-btn" data-payload="${copyPayload}" type="button"><i class="fa-solid fa-copy"></i> Copy</button>`;
    let prevBlock = '';
    if (isClear && wasPopulated) {
        const prevPayload = encodeURIComponent(sw.previousContent);
        prevBlock = `
            <details class="rpg-inspector-details">
                <summary>Show cleared content (${sw.previousContent.length} chars)</summary>
                <pre class="rpg-inspector-content rpg-inspector-content-prev">${escapeHtml(sw.previousContent)}</pre>
                <button class="rpg-inspector-copy-btn" data-payload="${prevPayload}" type="button"><i class="fa-solid fa-copy"></i> Copy cleared</button>
            </details>
        `;
    }
    return `
        <div class="rpg-inspector-sub">
            <div class="rpg-inspector-sub-head">
                <strong>${escapeHtml(sw.label)}</strong>
                ${sourceBadge}
                ${stateBadge}
                <span class="rpg-inspector-sub-meta">${ts}</span>
            </div>
            <div class="rpg-inspector-sub-meta">
                <code>${escapeHtml(sw.slot)}</code> · ${position} · depth=${sw.depth}${role}
            </div>
            ${contentHtml}
            ${copyBtn}
            ${prevBlock}
        </div>
    `;
}

function renderEventMutation(m) {
    const ts = new Date(m.timestamp).toLocaleTimeString();
    const msgRef = m.msgIdx == null ? 'prompt-wide' : `chat[${m.msgIdx}]`;
    const fullBefore = m.fullBefore != null ? m.fullBefore : m.beforeSnippet;
    const fullAfter = m.fullAfter != null ? m.fullAfter : m.afterSnippet;
    const beforePayload = encodeURIComponent(fullBefore);
    const afterPayload = encodeURIComponent(fullAfter);
    return `
        <div class="rpg-inspector-sub">
            <div class="rpg-inspector-sub-head">
                <strong>${escapeHtml(m.reason)}</strong>
                <span class="rpg-inspector-badge rpg-inspector-badge-mutation">${escapeHtml(m.event)}</span>
                <span class="rpg-inspector-badge">${escapeHtml(msgRef)}</span>
                <span class="rpg-inspector-sub-meta">${ts}</span>
            </div>
            <details class="rpg-inspector-details" open>
                <summary>Before → After</summary>
                <div class="rpg-inspector-diff">
                    <div class="rpg-inspector-diff-side">
                        <div class="rpg-inspector-diff-label">Before</div>
                        <pre class="rpg-inspector-content rpg-inspector-content-prev">${escapeHtml(m.beforeSnippet || '(empty)')}</pre>
                        <button class="rpg-inspector-copy-btn" data-payload="${beforePayload}" type="button"><i class="fa-solid fa-copy"></i> Copy${m.fullBefore == null ? ' snippet' : ''}</button>
                    </div>
                    <div class="rpg-inspector-diff-side">
                        <div class="rpg-inspector-diff-label">After</div>
                        <pre class="rpg-inspector-content">${escapeHtml(m.afterSnippet || '(empty)')}</pre>
                        <button class="rpg-inspector-copy-btn" data-payload="${afterPayload}" type="button"><i class="fa-solid fa-copy"></i> Copy${m.fullAfter == null ? ' snippet' : ''}</button>
                    </div>
                </div>
            </details>
        </div>
    `;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function copyAllAsJson() {
    const snap = snapshot();
    const text = JSON.stringify(snap, null, 2);
    navigator.clipboard.writeText(text).then(() => {
        try { toastr.success(`Copied full inspector snapshot (${text.length} chars).`, '', { timeOut: 2000 }); } catch {}
    }).catch(() => {
        try { toastr.error('Copy failed.', '', { timeOut: 1500 }); } catch {}
    });
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Quick tab-link hook (used in the empty-snapshot blurb)
$(document).on('click', '.rpg-inspector-tab-link', function (e) {
    e.preventDefault();
    const tab = $(this).data('tab');
    if (tab) {
        _currentTab = tab;
        renderModalBody();
    }
});
