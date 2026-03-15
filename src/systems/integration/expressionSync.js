/**
 * Character Expressions -> Present Characters portrait sync
 *
 * Mirrors SillyTavern's currently displayed Character Expressions image
 * into Doom's Present Characters panel and Portrait Bar, persisting the
 * last known expression for each character until they speak again.
 */
import { chat } from '../../../../../../../script.js';
import {
    extensionSettings,
    syncedExpressionPortraits,
    setSyncedExpressionPortrait,
    getSyncedExpressionPortrait,
    removeSyncedExpressionPortrait,
} from '../../core/state.js';
import { renderThoughts } from '../rendering/thoughts.js';
import { updatePortraitBar } from '../ui/portraitBar.js';
import { saveChatData } from '../../core/persistence.js';

let expressionContainerObserver = null;
let expressionImageObserver = null;
let observedExpressionImage = null;
let pendingSpeakerName = null;
let pendingSpeakerBaselineSignature = null;
let pendingSpeakerQueuedAt = 0;
let lastCapturedExpressionSrc = null;
let scheduledCaptureTimers = [];
let hiddenExpressionStyleElement = null;
let pendingCaptureRequestId = 0;

function normalizeName(name) {
    return String(name || '').trim().toLowerCase();
}

function normalizeExpressionSrc(src) {
    return String(src || '').trim();
}

function resolveExpressionUrl(src) {
    const normalized = normalizeExpressionSrc(src);
    if (!normalized) return null;

    try {
        return new URL(normalized, window.location.href);
    } catch {
        return null;
    }
}

function isDocumentLikeUrl(src) {
    const candidate = resolveExpressionUrl(src);
    if (!candidate) return false;

    const current = new URL(window.location.href);
    return candidate.origin === current.origin
        && candidate.pathname === current.pathname
        && candidate.search === current.search;
}

function isUsableExpressionSrc(src) {
    const normalized = normalizeExpressionSrc(src);
    if (!normalized) return false;

    const lower = normalized.toLowerCase();
    if (lower.includes('/img/default-expressions/') || lower.includes('/default-expressions/')) {
        return false;
    }

    if (isDocumentLikeUrl(normalized)) {
        return false;
    }

    return true;
}

function purgeInvalidSyncedExpressionPortraits() {
    let changed = false;

    for (const [storedName, src] of Object.entries(syncedExpressionPortraits)) {
        if (!isUsableExpressionSrc(src)) {
            removeSyncedExpressionPortrait(storedName);
            changed = true;
        }
    }

    if (changed) {
        saveChatData();
    }

    return changed;
}

function namesMatch(a, b) {
    const left = normalizeName(a);
    const right = normalizeName(b);
    if (!left || !right) return false;
    return left === right || left.startsWith(right + ' ') || right.startsWith(left + ' ');
}

export function getExpressionPortraitForCharacter(characterName) {
    const target = normalizeName(characterName);
    if (!target) return null;

    const exact = getSyncedExpressionPortrait(target);
    if (isUsableExpressionSrc(exact)) return exact;

    for (const [storedName, src] of Object.entries(syncedExpressionPortraits)) {
        if (namesMatch(storedName, target) && isUsableExpressionSrc(src)) return src;
    }

    return null;
}

function getLatestAssistantSpeakerName() {
    for (let i = chat.length - 1; i >= 0; i--) {
        const message = chat[i];
        if (!message || message.is_user || message.is_system) continue;
        return message.name || null;
    }
    return null;
}

function shouldHideNativeExpressionDisplay() {
    return extensionSettings.enabled === true && extensionSettings.hideDefaultExpressionDisplay === true;
}

function shouldRunExpressionObservers() {
    return extensionSettings.enabled === true && (
        extensionSettings.syncExpressionsToPresentCharacters === true
        || extensionSettings.hideDefaultExpressionDisplay === true
    );
}

function isExpressionContainerNode(node) {
    if (!(node instanceof Element)) return false;
    return !!node.closest('#expression-wrapper, #expression-holder, .expression-holder, [data-expression-container], #visual-novel-wrapper');
}

function getExpressionImageState(img) {
    if (!(img instanceof HTMLImageElement)) return null;

    const rawSrc = normalizeExpressionSrc(img.getAttribute('src'));
    const resolvedSrc = normalizeExpressionSrc(img.currentSrc || img.src || '');
    const src = rawSrc || '';
    const spriteFolderName = String(img.getAttribute('data-sprite-folder-name') || '').trim();
    const spriteFileName = String(img.getAttribute('data-sprite-filename') || '').trim();
    const expression = String(img.getAttribute('data-expression') || img.getAttribute('title') || '').trim();
    const isDefault = img.classList.contains('default')
        || rawSrc.toLowerCase().includes('/img/default-expressions/')
        || resolvedSrc.toLowerCase().includes('/img/default-expressions/');

    return {
        src,
        resolvedSrc,
        spriteFolderName,
        spriteFileName,
        expression,
        isDefault,
        signature: JSON.stringify({
            src,
            resolvedSrc,
            spriteFolderName,
            spriteFileName,
            expression,
            isDefault,
        }),
    };
}

function hasMeaningfulMetadataValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return Boolean(normalized && normalized !== 'null' && normalized !== 'undefined');
}

function looksLikeFallbackExpressionAsset(state) {
    if (!state) return true;

    const combined = [state.src, state.spriteFolderName, state.spriteFileName, state.expression]
        .map(value => String(value || '').trim().toLowerCase())
        .join(' ');

    return [
        '/img/default-expressions/',
        '/default-expressions/',
        '/emote/',
        '/emotes/',
        '/emoji/',
        '/emotion/',
        '/emotions/',
        ' default ',
        ' fallback ',
        ' placeholder ',
    ].some(fragment => combined.includes(fragment.trim()));
}

function hasRealSyncedSprite(state) {
    if (!state) return false;
    if (!state.src || state.isDefault) return false;
    if (!isUsableExpressionSrc(state.src)) return false;
    if (!hasMeaningfulMetadataValue(state.spriteFolderName)) return false;
    if (!hasMeaningfulMetadataValue(state.spriteFileName)) return false;
    if (!hasMeaningfulMetadataValue(state.expression)) return false;
    if (looksLikeFallbackExpressionAsset(state)) return false;

    return true;
}

function isProbablyExpressionImage(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    const state = getExpressionImageState(img);
    if (!state?.src) return false;

    const hasExpressionClass = img.classList.contains('expression') || img.id === 'expression-image';
    const hasExpressionMetadata = Boolean(state.expression || state.spriteFolderName || state.spriteFileName);

    if (!hasExpressionClass && !hasExpressionMetadata && !isExpressionContainerNode(img)) return false;
    return true;
}

function getPreferredVisualNovelImage(speakerName) {
    const target = normalizeName(speakerName);
    const candidates = Array.from(document.querySelectorAll('#visual-novel-wrapper .expression-holder img'))
        .filter(node => isProbablyExpressionImage(node) && hasRealSyncedSprite(getExpressionImageState(node)));

    if (!candidates.length) return null;
    if (!target) return candidates.find(node => node.offsetParent !== null) || candidates[0] || null;

    const exactMatch = candidates.find(node => {
        const state = getExpressionImageState(node);
        const folderRoot = String(state?.spriteFolderName || '').split('/')[0];
        return namesMatch(folderRoot, target);
    });
    if (exactMatch) return exactMatch;

    return candidates.find(node => node.offsetParent !== null) || candidates[0] || null;
}

function findExpressionImageElement(speakerName = null) {
    if (observedExpressionImage && observedExpressionImage.isConnected && isProbablyExpressionImage(observedExpressionImage)) {
        return observedExpressionImage;
    }

    const preferredSelectors = [
        '#expression-wrapper img.expression',
        '#expression-holder > img.expression',
        '#expression-image',
    ];

    for (const selector of preferredSelectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        const visibleMatch = nodes.find(node => isProbablyExpressionImage(node) && hasRealSyncedSprite(getExpressionImageState(node)) && node.offsetParent !== null);
        if (visibleMatch) return visibleMatch;

        const anyRealMatch = nodes.find(node => isProbablyExpressionImage(node) && hasRealSyncedSprite(getExpressionImageState(node)));
        if (anyRealMatch) return anyRealMatch;
    }

    const vnMatch = getPreferredVisualNovelImage(speakerName);
    if (vnMatch) return vnMatch;

    const allImages = Array.from(document.querySelectorAll('img.expression, #visual-novel-wrapper .expression-holder img'));
    return allImages.find(node => isProbablyExpressionImage(node) && hasRealSyncedSprite(getExpressionImageState(node))) || null;
}

function refreshExpressionConsumers() {
    renderThoughts({ preserveScroll: true });
    updatePortraitBar();
}

function getHideStyleCss() {
    return `
#expression-image,
#expression-holder,
.expression-holder,
[data-expression-container],
#expression-image img,
#expression-holder img,
.expression-holder img,
[data-expression-container] img {
    position: absolute !important;
    left: -10000px !important;
    top: 0 !important;
    width: 1px !important;
    height: 1px !important;
    overflow: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    visibility: hidden !important;
}
`;
}

function hideNativeExpressionDisplay() {
    if (hiddenExpressionStyleElement?.isConnected) return;

    const styleElement = document.createElement('style');
    styleElement.id = 'rpg-hidden-native-expression-display-style';
    styleElement.textContent = getHideStyleCss();
    document.head.appendChild(styleElement);
    hiddenExpressionStyleElement = styleElement;
}

function showNativeExpressionDisplay() {
    if (hiddenExpressionStyleElement?.isConnected) {
        hiddenExpressionStyleElement.remove();
    } else {
        document.getElementById('rpg-hidden-native-expression-display-style')?.remove();
    }
    hiddenExpressionStyleElement = null;
}

function syncNativeExpressionDisplayVisibility() {

    if (shouldHideNativeExpressionDisplay()) {
        hideNativeExpressionDisplay();
    } else {
        showNativeExpressionDisplay();
    }
}

function teardownExpressionObservers() {
    if (expressionContainerObserver) {
        expressionContainerObserver.disconnect();
        expressionContainerObserver = null;
    }

    if (expressionImageObserver) {
        expressionImageObserver.disconnect();
        expressionImageObserver = null;
    }

    observedExpressionImage = null;
}

function captureExpressionForSpeaker(speakerName, expectedRequestId = null) {
    if (!extensionSettings.enabled || !extensionSettings.syncExpressionsToPresentCharacters) return false;
    if (expectedRequestId !== null && expectedRequestId !== pendingCaptureRequestId) return false;

    const name = normalizeName(speakerName || pendingSpeakerName || getLatestAssistantSpeakerName());
    if (!name) return false;

    const previous = getSyncedExpressionPortrait(name);
    const img = findExpressionImageElement(name);
    const state = getExpressionImageState(img);
    if (!hasRealSyncedSprite(state)) {
        const elapsed = pendingSpeakerQueuedAt ? (Date.now() - pendingSpeakerQueuedAt) : 0;
        if (previous && elapsed >= 1200) {
            removeSyncedExpressionPortrait(name);
            saveChatData();
            refreshExpressionConsumers();
        }
        return false;
    }

    pendingSpeakerName = name;

    // After a speaker switch, SillyTavern may continue showing the previous
    // speaker's portrait until the classifier finishes. Do not capture that
    // unchanged baseline for the new speaker; wait for the expression widget to
    // actually change or for this speaker's previously stored portrait to remain.
    if (pendingSpeakerBaselineSignature && state.signature === pendingSpeakerBaselineSignature && previous !== state.src) {
        return false;
    }

    if (previous === state.src && lastCapturedExpressionSrc === state.src) {
        return true;
    }

    lastCapturedExpressionSrc = state.src;
    pendingSpeakerBaselineSignature = null;
    setSyncedExpressionPortrait(name, state.src);
    saveChatData();
    refreshExpressionConsumers();
    return true;
}

function observeExpressionImage(img) {
    if (!shouldRunExpressionObservers()) return;
    if (!img || observedExpressionImage === img) return;

    if (expressionImageObserver) {
        expressionImageObserver.disconnect();
    }

    observedExpressionImage = img;
    expressionImageObserver = new MutationObserver(() => {
        captureExpressionForSpeaker(pendingSpeakerName, pendingCaptureRequestId);
    });

    expressionImageObserver.observe(img, {
        attributes: true,
        attributeFilter: ['src', 'class', 'style', 'title', 'data-expression', 'data-sprite-folder-name', 'data-sprite-filename'],
    });
}

function ensureExpressionObservers() {
    syncNativeExpressionDisplayVisibility();

    if (!shouldRunExpressionObservers()) {
        teardownExpressionObservers();
        return;
    }

    const currentImg = findExpressionImageElement(pendingSpeakerName);
    if (currentImg) {
        observeExpressionImage(currentImg);
    } else if (expressionImageObserver) {
        expressionImageObserver.disconnect();
        expressionImageObserver = null;
        observedExpressionImage = null;
    }

    if (expressionContainerObserver) return;

    expressionContainerObserver = new MutationObserver(() => {
        if (!shouldRunExpressionObservers()) {
            teardownExpressionObservers();
            syncNativeExpressionDisplayVisibility();
            return;
        }

        const img = findExpressionImageElement(pendingSpeakerName);
        if (img) {
            observeExpressionImage(img);
            captureExpressionForSpeaker(pendingSpeakerName, pendingCaptureRequestId);
        } else if (expressionImageObserver) {
            expressionImageObserver.disconnect();
            expressionImageObserver = null;
            observedExpressionImage = null;
        }
        syncNativeExpressionDisplayVisibility();
    });

    expressionContainerObserver.observe(document.body, {
        childList: true,
        subtree: true,
    });
}

function clearScheduledCaptures() {
    for (const timer of scheduledCaptureTimers) {
        clearTimeout(timer);
    }
    scheduledCaptureTimers = [];
}

export function queueExpressionCaptureForSpeaker(speakerName) {
    if (!extensionSettings.enabled || !extensionSettings.syncExpressionsToPresentCharacters) return;

    pendingSpeakerName = normalizeName(speakerName || getLatestAssistantSpeakerName());
    if (!pendingSpeakerName) return;

    const currentImg = findExpressionImageElement(pendingSpeakerName);
    const currentState = getExpressionImageState(currentImg);
    pendingSpeakerBaselineSignature = currentState?.signature || null;
    pendingSpeakerQueuedAt = Date.now();
    pendingCaptureRequestId += 1;
    const requestId = pendingCaptureRequestId;

    ensureExpressionObservers();
    clearScheduledCaptures();

    for (const delay of [50, 200, 500, 900, 1500, 2200]) {
        const timer = setTimeout(() => captureExpressionForSpeaker(pendingSpeakerName, requestId), delay);
        scheduledCaptureTimers.push(timer);
    }
}

export function syncExpressionFromLatestMessage() {
    if (!extensionSettings.enabled || !extensionSettings.syncExpressionsToPresentCharacters) return;
    queueExpressionCaptureForSpeaker(getLatestAssistantSpeakerName());
}

export function initExpressionSync() {
    if (purgeInvalidSyncedExpressionPortraits()) {
        refreshExpressionConsumers();
    }
    ensureExpressionObservers();
    if (extensionSettings.syncExpressionsToPresentCharacters) {
        syncExpressionFromLatestMessage();
    }
}

export function onExpressionSyncChatChanged() {
    if (!extensionSettings.enabled) {
        showNativeExpressionDisplay();
        return;
    }

    const purged = purgeInvalidSyncedExpressionPortraits();
    if (purged) {
        refreshExpressionConsumers();
    }

    const retryDelays = [0, 80, 220, 500];
    for (const delay of retryDelays) {
        setTimeout(() => {
            ensureExpressionObservers();
            syncNativeExpressionDisplayVisibility();
            if (extensionSettings.syncExpressionsToPresentCharacters) {
                syncExpressionFromLatestMessage();
            } else {
                refreshExpressionConsumers();
            }
        }, delay);
    }
}

export function onExpressionSyncSettingChanged(enabled) {
    if (enabled) {
        const purged = purgeInvalidSyncedExpressionPortraits();
        initExpressionSync();
        // Re-apply any previously restored per-chat synced portraits immediately,
        // then allow the current speaker to update their own portrait if needed.
        if (!purged) {
            refreshExpressionConsumers();
        }
        syncExpressionFromLatestMessage();
        return;
    }

    ensureExpressionObservers();
    clearScheduledCaptures();
    pendingCaptureRequestId += 1;
    pendingSpeakerName = null;
    pendingSpeakerBaselineSignature = null;
    pendingSpeakerQueuedAt = 0;
    lastCapturedExpressionSrc = null;
    // Intentionally keep persisted per-chat synced portraits intact while the
    // feature is disabled so they can be restored when re-enabled.
    refreshExpressionConsumers();
}

export function onHideDefaultExpressionDisplaySettingChanged(enabled) {
    extensionSettings.hideDefaultExpressionDisplay = enabled === true;
    ensureExpressionObservers();
    syncNativeExpressionDisplayVisibility();
    setTimeout(() => syncNativeExpressionDisplayVisibility(), 0);
    setTimeout(() => syncNativeExpressionDisplayVisibility(), 120);
}

export function clearExpressionSyncCache() {
    clearScheduledCaptures();
    pendingCaptureRequestId += 1;
    pendingSpeakerName = null;
    pendingSpeakerBaselineSignature = null;
    pendingSpeakerQueuedAt = 0;
    lastCapturedExpressionSrc = null;
    teardownExpressionObservers();
    showNativeExpressionDisplay();
}
