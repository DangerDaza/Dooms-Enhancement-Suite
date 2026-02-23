/**
 * TTS Sentence-Level Highlight Module — "Gradient Glow Pill" style
 *
 * Highlights the sentence currently being read by SillyTavern's TTS system
 * using DOM-based sentence wrapping with gradient background glow effect.
 *
 * Works by monkey-patching speechSynthesis.speak() to intercept every
 * SpeechSynthesisUtterance chunk. Uses two strategies:
 *
 *  1) Primary: onboundary events (gives precise charIndex per word —
 *     we expand it to the full containing sentence)
 *  2) Fallback: timer-based sentence progression (for voices/browsers that
 *     don't fire boundary events — estimates sentence timing from speech rate)
 *
 * Sentences are pre-split into <span> elements when TTS begins, then
 * CSS classes are toggled for read/active/unread states.
 */
import { extensionSettings } from '../../core/state.js';

// ─────────────────────────────────────────────
//  Module state
// ─────────────────────────────────────────────

let _originalSpeak = null;
let _isPatched = false;
let _isActive = false;

/** @type {HTMLElement|null} */
let _activeMessage = null;

/** @type {{el: HTMLSpanElement, start: number, end: number}[]} */
let _sentenceSpans = [];       // All sentence spans in the current message
let _activeSentenceIndex = -1; // Index of the currently highlighted sentence

let _pollTimer = null;
let _wasSpeaking = false;

// Timer-based fallback state
let _timerHandle = null;
let _timerRunning = false;     // True while the continuous timer is active
let _boundaryFired = false;
let _timerSpeechRate = 1;
let _timerFullText = '';

// Chunk pause/resume state (Fix 1: prevents inter-chunk gap drift)
let _timerPaused = false;      // True while waiting between chunks
let _timerRemainingMs = 0;     // ms remaining on current sentence when paused

// WPM calibration state (Fix 3: adapts estimate to actual voice speed)
let _lastChunkStartTime = 0;   // performance.now() when current chunk's 'start' fired
let _lastChunkWordCount = 0;   // word count of current chunk
let _calibratedMsPerWord = 310; // rolling estimate, initialized to baseline

// Original DOM content for restoration
let _originalMesTextHTML = '';
let _chunkCounter = 0;
let _bubbleModeActive = false;   // True when TTS is highlighting inside bubble-wrapped content

// ─────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────

export function initTtsHighlight() {
    _installSpeakPatch();
    _pollTimer = setInterval(_pollTtsState, 500);
    _isActive = _getMode() !== 'off';

    console.log('[Dooms TTS Highlight] initTtsHighlight() OK — Gradient Glow Pill mode');
}

export function destroyTtsHighlight() {
    _isActive = false;
    _cleanup();
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

export function onTtsHighlightModeChanged(oldMode, newMode) {
    if (oldMode === newMode) return;
    _cleanup();
    _isActive = (newMode !== 'off');
}

/**
 * Read ttsHighlightSettings from extensionSettings and apply as CSS custom
 * properties on :root so the stylesheet picks them up in real time.
 */
export function applyTtsHighlightSettings() {
    const s = extensionSettings.ttsHighlightSettings || {};
    const root = document.documentElement.style;

    // Parse hex colors into r,g,b for use in rgba()
    const parseHex = (hex, fallback) => {
        hex = hex || fallback;
        const r = parseInt(hex.slice(1, 3), 16) || 0;
        const g = parseInt(hex.slice(3, 5), 16) || 0;
        const b = parseInt(hex.slice(5, 7), 16) || 0;
        return { r, g, b };
    };

    const left = parseHex(s.gradientColorLeft, '#e94560');
    const right = parseHex(s.gradientColorRight, '#9333ea');

    root.setProperty('--dooms-tts-left-r', left.r);
    root.setProperty('--dooms-tts-left-g', left.g);
    root.setProperty('--dooms-tts-left-b', left.b);
    root.setProperty('--dooms-tts-right-r', right.r);
    root.setProperty('--dooms-tts-right-g', right.g);
    root.setProperty('--dooms-tts-right-b', right.b);

    root.setProperty('--dooms-tts-gradient-opacity', (s.gradientOpacity ?? 30) / 100);
    root.setProperty('--dooms-tts-glow', (s.glowIntensity ?? 16) + 'px');
    root.setProperty('--dooms-tts-active-color', s.overrideTextColor ? (s.activeTextColor || '#ffffff') : 'inherit');
    root.setProperty('--dooms-tts-radius', (s.borderRadius ?? 4) + 'px');
    root.setProperty('--dooms-tts-read-opacity', (s.readOpacity ?? 35) / 100);
    root.setProperty('--dooms-tts-unread-opacity', (s.unreadOpacity ?? 55) / 100);
    root.setProperty('--dooms-tts-transition', (s.transitionSpeed ?? 300) + 'ms');
}

// ─────────────────────────────────────────────
//  Monkey-patch speechSynthesis.speak
// ─────────────────────────────────────────────

function _installSpeakPatch() {
    if (_isPatched) return;
    if (!('speechSynthesis' in window)) {
        console.warn('[Dooms TTS Highlight] speechSynthesis not available');
        return;
    }

    _originalSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);

    window.speechSynthesis.speak = function (utterance) {
        if (_isActive && utterance && utterance.text) {
            try {
                // Clean the utterance text before TTS speaks it.
                // This strips hidden tags (like <Mira> <ENFP-H>), HTML blocks,
                // and other non-visible content so TTS only reads what the user sees.
                // The same clean text is then used for highlight sentence matching.
                const rawText = utterance.text;
                const cleanText = _cleanTtsText(rawText);

                if (cleanText !== rawText) {
                    utterance.text = cleanText;
                    console.log(`[Dooms TTS Highlight] Cleaned TTS text: ${rawText.length} → ${cleanText.length} chars`);
                }

                _onUtteranceIntercepted(utterance);
            } catch (e) {
                console.error('[Dooms TTS Highlight] Error in utterance intercept:', e);
            }
        }
        return _originalSpeak(utterance);
    };

    _isPatched = true;
    console.log('[Dooms TTS Highlight] speechSynthesis.speak monkey-patch installed');
}

/**
 * Clean TTS text by removing content that is hidden in the DOM but present in
 * message.mes. This ensures TTS only speaks what the user can see, AND ensures
 * our highlight sentence positions match what TTS actually speaks.
 *
 * Strips:
 *  - Unpaired angle-bracket tags: <Mira>, <ENFP-H>, <Sakura>, etc.
 *  - HTML block elements with style attributes: <div style="...">, <span style="...">
 *  - HTML closing tags and self-closing tags
 *  - <br> tags (replaced with space)
 *  - Resulting extra whitespace
 *
 * Does NOT modify the original message data — only the utterance text.
 */
function _cleanTtsText(text) {
    if (!text) return text;

    let cleaned = text;

    // Remove full HTML blocks: <div ...>...</div>, <span ...>...</span>
    // These are styled note blocks, hidden containers, etc.
    // Use a loop in case of nested blocks
    let prev;
    do {
        prev = cleaned;
        cleaned = cleaned.replace(/<(div|span|p)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    } while (cleaned !== prev);

    // Remove any remaining HTML tags (self-closing, br, orphaned closing tags, etc.)
    cleaned = cleaned.replace(/<br\s*\/?>/gi, ' ');
    cleaned = cleaned.replace(/<\/[^>]+>/g, ' ');

    // Remove any orphaned opening HTML tags with attributes (partial blocks from chunking)
    cleaned = cleaned.replace(/<(div|span|p|br)\s[^>]*>/gi, ' ');

    // Remove unpaired angle-bracket tags: <Word>, <Word-Word>, etc.
    // These are the hidden character/personality tags like <Mira>, <ENFP-H>
    cleaned = cleaned.replace(/<[A-Za-z][A-Za-z0-9\-]*>/g, '');

    // Collapse whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
}

// ─────────────────────────────────────────────
//  Sentence splitting — wraps mes_text content
//  in <span class="dooms-tts-sentence"> elements
// ─────────────────────────────────────────────

/**
 * Pre-split all text in mes_text into sentence spans.
 * This mutates the DOM once at TTS start, replacing text nodes
 * with <span> wrappers. Original HTML is saved for restoration.
 *
 * Strategy: use a TreeWalker to collect all text nodes, identify
 * sentence boundaries in the concatenated text, then wrap each
 * sentence segment within its text node(s).
 */
/**
 * Check if an element or any of its ancestors is hidden (display:none, visibility:hidden,
 * or has a common "hidden" class/attribute).
 */
function _isHiddenElement(el) {
    let current = el;
    while (current && current !== document.body) {
        if (current.nodeType === Node.ELEMENT_NODE) {
            const style = window.getComputedStyle(current);
            if (style.display === 'none' || style.visibility === 'hidden') {
                return true;
            }
            // Also check common hidden attributes/classes
            if (current.hidden || current.getAttribute('aria-hidden') === 'true') {
                return true;
            }
        }
        current = current.parentNode;
    }
    return false;
}

/**
 * Check if a node is inside a .dooms-bubble-text element.
 * In bubble mode, only text inside these elements is actual message content —
 * headers (character names), avatars, and buttons should be excluded.
 */
function _isInsideBubbleText(node) {
    let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (current) {
        if (current.classList && current.classList.contains('dooms-bubble-text')) return true;
        if (current.classList && current.classList.contains('dooms-bubbles')) return false;
        current = current.parentElement;
    }
    return false;
}

/**
 * Get only the visible text content of an element, skipping hidden children.
 * This matches what TTS actually reads (message.mes without hidden DOM injections).
 * In bubble mode, only collects text from .dooms-bubble-text elements.
 */
function _getVisibleText(el) {
    if (!el) return '';
    let text = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: function(node) {
            if (node.textContent.length === 0) return NodeFilter.FILTER_REJECT;
            if (_isHiddenElement(node.parentElement)) return NodeFilter.FILTER_REJECT;
            // In bubble mode, only include text inside .dooms-bubble-text elements
            if (_bubbleModeActive && !_isInsideBubbleText(node)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    let node;
    while ((node = walker.nextNode())) {
        text += node.textContent;
    }
    return text;
}

function _splitSentences(mesTextEl) {
    _sentenceSpans = [];

    // Save original HTML for cleanup restoration
    _originalMesTextHTML = mesTextEl.innerHTML;

    // Collect all VISIBLE text nodes — skip nodes inside hidden elements
    // This prevents hidden injected content (character tags, extension metadata, etc.)
    // from being included in sentence splitting and position calculations.
    // In bubble mode, only collect text from .dooms-bubble-text elements (skip headers,
    // avatar letters, button text etc. that aren't part of the actual message content).
    const textNodes = [];
    const walker = document.createTreeWalker(mesTextEl, NodeFilter.SHOW_TEXT, {
        acceptNode: function(node) {
            if (node.textContent.length === 0) return NodeFilter.FILTER_REJECT;
            if (_isHiddenElement(node.parentElement)) return NodeFilter.FILTER_REJECT;
            if (_bubbleModeActive && !_isInsideBubbleText(node)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    let node;
    while ((node = walker.nextNode())) {
        textNodes.push(node);
    }

    if (textNodes.length === 0) return;

    // Build full text and offset map from visible text only
    let fullText = '';
    let nodeEntries = [];
    let offset = 0;
    for (const tn of textNodes) {
        const len = tn.textContent.length;
        nodeEntries.push({ node: tn, start: offset, end: offset + len });
        fullText += tn.textContent;
        offset += len;
    }

    // Find all sentence boundaries
    const boundaries = _findAllSentenceBoundaries(fullText);
    if (boundaries.length === 0) return;

    console.log(`[Dooms TTS Highlight] Splitting ${boundaries.length} sentences in message`);

    // For each text node, split it according to sentence boundaries
    // We process in reverse so earlier node references stay valid
    for (let ni = nodeEntries.length - 1; ni >= 0; ni--) {
        const entry = nodeEntries[ni];
        const textNode = entry.node;
        const parent = textNode.parentNode;
        if (!parent) continue;

        // Find which sentence boundaries fall within this text node
        const segments = [];
        for (let si = 0; si < boundaries.length; si++) {
            const sent = boundaries[si];
            // Check overlap
            const overlapStart = Math.max(sent.start, entry.start);
            const overlapEnd = Math.min(sent.end, entry.end);
            if (overlapStart < overlapEnd) {
                segments.push({
                    sentenceIndex: si,
                    localStart: overlapStart - entry.start,
                    localEnd: overlapEnd - entry.start,
                });
            }
        }

        if (segments.length === 0) continue;

        // Replace the text node with span-wrapped segments
        const frag = document.createDocumentFragment();
        let lastEnd = 0;

        for (const seg of segments) {
            // Any text before this segment (shouldn't happen usually, but be safe)
            if (seg.localStart > lastEnd) {
                frag.appendChild(document.createTextNode(
                    textNode.textContent.substring(lastEnd, seg.localStart)
                ));
            }

            const span = document.createElement('span');
            span.className = 'dooms-tts-sentence dooms-tts-unread';
            span.dataset.sentIdx = seg.sentenceIndex;
            span.textContent = textNode.textContent.substring(seg.localStart, seg.localEnd);
            frag.appendChild(span);

            // Register the span in our sentence map
            if (!_sentenceSpans[seg.sentenceIndex]) {
                _sentenceSpans[seg.sentenceIndex] = {
                    els: [],
                    start: boundaries[seg.sentenceIndex].start,
                    end: boundaries[seg.sentenceIndex].end,
                };
            }
            _sentenceSpans[seg.sentenceIndex].els.push(span);

            lastEnd = seg.localEnd;
        }

        // Any trailing text
        if (lastEnd < textNode.textContent.length) {
            frag.appendChild(document.createTextNode(
                textNode.textContent.substring(lastEnd)
            ));
        }

        parent.replaceChild(frag, textNode);
    }

    // Fill any gaps (sentences that had no text node overlap)
    _sentenceSpans = _sentenceSpans.filter(Boolean);

    console.log(`[Dooms TTS Highlight] Created ${_sentenceSpans.length} sentence span groups`);
}

/**
 * Find all sentence boundaries in the given text.
 * Returns an array of {start, end} objects.
 */
function _findAllSentenceBoundaries(text) {
    const boundaries = [];
    let pos = 0;

    // Skip leading whitespace
    while (pos < text.length && /\s/.test(text[pos])) pos++;

    while (pos < text.length) {
        const bounds = _findSentenceBoundsAt(text, pos);
        if (!bounds || bounds.start >= bounds.end) {
            pos++;
            continue;
        }

        boundaries.push(bounds);
        pos = bounds.end;

        // Skip whitespace between sentences
        while (pos < text.length && /\s/.test(text[pos])) pos++;
    }

    return boundaries;
}

/**
 * Find sentence bounds starting at or near the given position.
 */
function _findSentenceBoundsAt(text, pos) {
    if (pos >= text.length) return null;

    // Skip leading whitespace
    let start = pos;
    while (start < text.length && (text[start] === ' ' || text[start] === '\t')) {
        start++;
    }
    if (start >= text.length) return null;

    // Find sentence end
    let end = text.length;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];

        // Newline is always a sentence break
        if (ch === '\n') {
            end = i;
            break;
        }

        if (ch === '.' || ch === '!' || ch === '?') {
            let j = i + 1;
            // Skip trailing punctuation (e.g., '..."' or '?!')
            while (j < text.length && (text[j] === '.' || text[j] === '!' || text[j] === '?' || text[j] === '"' || text[j] === '\u201D' || text[j] === "'" || text[j] === '\u2019')) {
                j++;
            }
            // If followed by whitespace or end-of-text, this is a sentence boundary
            if (j >= text.length || text[j] === ' ' || text[j] === '\n' || text[j] === '\t') {
                end = j;
                break;
            }
        }
    }

    if (start >= end) return null;
    return { start, end };
}

// ─────────────────────────────────────────────
//  Utterance interception
// ─────────────────────────────────────────────

function _onUtteranceIntercepted(utterance) {
    const rawChunkText = utterance.text;
    if (!rawChunkText || rawChunkText.trim().length === 0) return;

    _ensureSetupForCurrentMessage();
    if (_sentenceSpans.length === 0) return;

    const mesTextEl = _activeMessage.querySelector('.mes_text');
    const fullVisibleText = _getVisibleText(mesTextEl);

    console.log(`[Dooms TTS Highlight] ──── CHUNK ${_chunkCounter++} ────`);
    console.log(`[Dooms TTS Highlight]   Text (first 100): "${rawChunkText.substring(0, 100)}"`);
    console.log(`[Dooms TTS Highlight]   ${rawChunkText.length} chars, activeSent: ${_activeSentenceIndex}`);

    // ── Strategy 1: onboundary events → word-based sentence matching ──
    utterance.addEventListener('boundary', (event) => {
        if (!_isActive) return;
        if (event.name !== 'word') return;

        if (!_boundaryFired) {
            _boundaryFired = true;
            _stopTimerFallback();
            console.log('[Dooms TTS Highlight] boundary events active — using word matching');
        }

        try {
            const word = _getWordFromBoundary(rawChunkText, event.charIndex, event.charLength);
            if (!word || word.trim().length === 0) return;

            const sentIdx = _findSentenceByWord(word, fullVisibleText);

            if (sentIdx >= 0 && sentIdx !== _activeSentenceIndex) {
                _setActiveSentence(sentIdx);
            }
        } catch (e) {
            // Silently fail
        }
    });

    // Fix 1: Pause the timer when a chunk ends so inter-chunk gaps don't cause
    // the highlight to run ahead of the voice. The timer persists across chunks
    // (we do NOT call _stopTimerFallback here) — we simply freeze it mid-sentence
    // and resume when the next chunk's 'start' fires.
    utterance.addEventListener('end', () => {
        if (!_isActive || !_timerRunning || _boundaryFired) return;
        // Fix 3: Calibrate WPM estimate from this chunk's actual duration
        if (_lastChunkStartTime > 0 && _lastChunkWordCount > 2) {
            const actualMs = performance.now() - _lastChunkStartTime;
            if (actualMs > 200) {
                const actualMsPerWord = actualMs / _lastChunkWordCount;
                // Exponential moving average — smooth out outliers
                _calibratedMsPerWord = _calibratedMsPerWord * 0.6 + actualMsPerWord * 0.4;
                console.log(`[Dooms TTS Highlight] Calibrated: ${actualMsPerWord.toFixed(0)}ms/word → avg ${_calibratedMsPerWord.toFixed(0)}ms/word`);
            }
        }
        _lastChunkStartTime = 0;
        // Pause timer — freeze the countdown until the next chunk begins
        if (_timerHandle) { clearTimeout(_timerHandle); _timerHandle = null; }
        _timerPaused = true;
        console.log(`[Dooms TTS Highlight] Timer paused at chunk end — ${_timerRemainingMs}ms saved for current sentence`);
    });

    // Fix 1: Resume the timer when the next chunk actually starts speaking.
    // Also record timing data for WPM calibration.
    utterance.addEventListener('start', () => {
        if (!_isActive || !_timerRunning || _boundaryFired) return;
        _lastChunkStartTime = performance.now();
        _lastChunkWordCount = (utterance.text.match(/\S+/g) || []).length;
        if (_timerPaused) {
            _timerPaused = false;
            const resumeMs = Math.max(50, _timerRemainingMs);
            _timerHandle = setTimeout(_advanceTimerSentence, resumeMs);
            console.log(`[Dooms TTS Highlight] Timer resumed — ${resumeMs}ms remaining for current sentence`);
        }
    });

    // ── Strategy 2: Timer-based continuous sentence progression ──
    // Start the timer only ONCE on the first chunk. It will keep running
    // across all subsequent chunks until TTS stops.
    if (!_timerRunning && !_boundaryFired) {
        // Activate the first sentence immediately
        if (_activeSentenceIndex < 0) {
            _setActiveSentence(0);
        }
        _startTimerFallback(utterance.rate || 1, fullVisibleText);
    } else if (_timerRunning && !_boundaryFired && _chunkCounter > 1) {
        // Fix 2: Resync — if the timer drifted ahead while processing earlier chunks,
        // snap back to where the speech engine actually is now.
        _resyncTimerToChunk(rawChunkText, fullVisibleText);
    }
}

function _getWordFromBoundary(text, charIndex, charLength) {
    if (charLength && charLength > 0) {
        return text.substring(charIndex, charIndex + charLength);
    }
    const remaining = text.substring(charIndex);
    const match = remaining.match(/^[^\s]+/);
    return match ? match[0] : '';
}

// ─────────────────────────────────────────────
//  Sentence lookup by position
// ─────────────────────────────────────────────

/**
 * Find which sentence contains a spoken word by searching sentence text directly.
 * This is more robust than position-based matching because it doesn't depend on
 * TTS chunk positions matching DOM text positions (which can diverge due to
 * hidden tags, HTML blocks, formatting differences, etc.)
 *
 * Logic: if the word is found in the CURRENT active sentence, return current index
 * (no advancement). If the word is NOT in the current sentence but IS in the next
 * few sentences, return that sentence index (triggers advancement).
 * This naturally advances when TTS crosses a sentence boundary.
 *
 * @param {string} word - The word spoken by TTS
 * @param {string} fullVisibleText - The full visible text
 * @returns {number} sentence index, or -1 if not found
 */
function _findSentenceByWord(word, fullVisibleText) {
    if (!word || word.length < 2) return -1;

    const cleanWord = word.replace(/[.,!?;:'"—–\-()[\]{}]/g, '').toLowerCase();
    if (cleanWord.length < 2) return -1;

    const currentIdx = Math.max(0, _activeSentenceIndex);

    // First check: is the word in the current sentence? If so, stay.
    if (currentIdx < _sentenceSpans.length) {
        const currentSent = _sentenceSpans[currentIdx];
        const currentText = fullVisibleText.substring(currentSent.start, currentSent.end).toLowerCase();
        if (currentText.includes(cleanWord)) {
            return currentIdx; // Word is still in current sentence
        }
    }

    // Word is NOT in current sentence — look ahead for it
    const endIdx = Math.min(_sentenceSpans.length, currentIdx + 6);
    for (let i = currentIdx + 1; i < endIdx; i++) {
        const sent = _sentenceSpans[i];
        const sentText = fullVisibleText.substring(sent.start, sent.end).toLowerCase();
        if (sentText.includes(cleanWord)) {
            return i; // Found in a later sentence — advance to it
        }
    }

    return -1; // Word not found nearby
}

// ─────────────────────────────────────────────
//  Highlight state management — toggles CSS classes
// ─────────────────────────────────────────────

/**
 * Set the active sentence and update all span classes:
 *  - sentences before active → dooms-tts-read (dimmed)
 *  - active sentence → dooms-tts-active-sentence (gradient glow)
 *  - sentences after active → dooms-tts-unread (slightly dimmed)
 */
function _setActiveSentence(index) {
    if (index === _activeSentenceIndex) return;
    _activeSentenceIndex = index;

    for (let i = 0; i < _sentenceSpans.length; i++) {
        const spans = _sentenceSpans[i].els;
        let className;

        if (i < index) {
            className = 'dooms-tts-sentence dooms-tts-read';
        } else if (i === index) {
            className = 'dooms-tts-sentence dooms-tts-active-sentence';
        } else {
            className = 'dooms-tts-sentence dooms-tts-unread';
        }

        for (const el of spans) {
            el.className = className;
        }
    }


    console.log(`[Dooms TTS Highlight] Active sentence: ${index + 1}/${_sentenceSpans.length}`);
}

// ─────────────────────────────────────────────
//  Timer-based fallback: sentence-by-sentence
// ─────────────────────────────────────────────

/**
 * Estimate how long a sentence takes to speak based on its content.
 * Accounts for: word count, average word length, punctuation pauses,
 * and the TTS speech rate setting.
 *
 * Calibrated for Google US English voices:
 *   ~200 words/min at rate 1.0 → ~300ms per word baseline
 *   Adjusted down slightly because TTS engines speak faster than humans
 *   with less inter-word pause.
 */
function _estimateSentenceDurationMs(sentenceText, speechRate, calibratedMsPerWord) {
    const rate = speechRate || 1;
    const words = sentenceText.match(/\S+/g) || [];
    if (words.length === 0) return 150 / rate;

    // Base time per word — slight adjustment for average word length
    // Short words (~3 chars) are spoken faster, long words (~8+) slower
    const avgWordLen = words.reduce((sum, w) => sum + w.length, 0) / words.length;
    const wordLenFactor = 0.85 + (avgWordLen / 25); // ~1.0 for typical text
    // Use calibrated WPM if available (from actual chunk timing), else 310ms baseline
    const baseMs = (calibratedMsPerWord || 310) * wordLenFactor;

    let totalMs = words.length * baseMs;

    // Add brief pauses for punctuation
    const commas = (sentenceText.match(/[,;:]/g) || []).length;
    const periods = (sentenceText.match(/[.!?]+/g) || []).length;
    const ellipsis = (sentenceText.match(/\.\.\./g) || []).length;
    const dashes = (sentenceText.match(/[—–-]{2,}/g) || []).length;
    totalMs += commas * 100;    // Brief pause for commas
    totalMs += periods * 150;   // Pause for sentence-end
    totalMs += ellipsis * 250;  // Longer pause for dramatic ellipsis
    totalMs += dashes * 120;    // Pause for dashes

    return Math.round(totalMs / rate);
}

/**
 * Timer fallback: continuous sequential sentence advancement.
 *
 * Started ONCE when the first TTS chunk arrives. Continuously advances through
 * ALL sentences at estimated speech pace. Persists across all chunks.
 *
 * Stops when:
 *   - boundary events take over (more accurate)
 *   - _cleanup() runs (TTS fully stopped, detected by poll)
 *   - we run out of sentences
 *
 * @param {number} speechRate - Speech rate multiplier
 * @param {string} fullVisibleText - The full visible text from the DOM
 */
function _startTimerFallback(speechRate, fullVisibleText) {
    if (_timerRunning) return; // Already running
    if (_sentenceSpans.length === 0) return;

    _timerSpeechRate = speechRate;
    _timerFullText = fullVisibleText;
    _timerRunning = true;
    _timerPaused = false;

    const startIdx = Math.max(0, _activeSentenceIndex);
    console.log(`[Dooms TTS Highlight] Timer started — continuous from sentence ${startIdx}/${_sentenceSpans.length}`);

    // Estimate duration of the current sentence, then schedule advancement
    const sent = _sentenceSpans[startIdx];
    const sentText = _timerFullText.substring(sent.start, sent.end);
    const durationMs = _estimateSentenceDurationMs(sentText, _timerSpeechRate, _calibratedMsPerWord);

    _timerRemainingMs = durationMs;
    _timerHandle = setTimeout(_advanceTimerSentence, durationMs);
}

function _stopTimerFallback() {
    if (_timerHandle) {
        clearTimeout(_timerHandle);
        _timerHandle = null;
    }
    _timerRunning = false;
    _timerPaused = false;
    _timerRemainingMs = 0;
    _timerFullText = '';
}

/**
 * Fix 2: Resync the timer to match where the speech engine actually is.
 *
 * When chunk N+1 arrives we know which text the engine is ABOUT to speak.
 * If the timer drifted AHEAD (highlight is on sentence M but the engine is
 * only starting sentence M-3), we snap back to the correct sentence.
 *
 * Strategy: take the first "significant" word (≥4 chars) from the chunk,
 * search backward through sentences already passed, snap if found.
 * Only corrects run-ahead drift — never skips forward.
 */
function _resyncTimerToChunk(chunkText, fullVisibleText) {
    if (!chunkText || _sentenceSpans.length === 0 || _activeSentenceIndex <= 0) return;

    // Find first significant word (≥4 alphanum chars) — short words appear in too many sentences
    const words = chunkText.trim().match(/\S+/g) || [];
    const anchorWord = words.find(w => w.replace(/[^\w]/g, '').length >= 4);
    if (!anchorWord) return;
    const clean = anchorWord.replace(/[.,!?;:'"—–\-()[\]{}]/g, '').toLowerCase();
    if (clean.length < 4) return;

    // Search ONLY backward (sentences before current active index)
    for (let i = 0; i < _activeSentenceIndex; i++) {
        const sent = _sentenceSpans[i];
        const sentText = fullVisibleText.substring(sent.start, sent.end).toLowerCase();
        if (sentText.includes(clean)) {
            console.log(`[Dooms TTS Highlight] Resync: timer was at sentence ${_activeSentenceIndex}, snapping back to ${i} (anchor: "${clean}")`);
            if (_timerHandle) { clearTimeout(_timerHandle); _timerHandle = null; }
            _setActiveSentence(i);
            const dur = _estimateSentenceDurationMs(
                fullVisibleText.substring(sent.start, sent.end),
                _timerSpeechRate, _calibratedMsPerWord
            );
            _timerRemainingMs = dur;
            _timerPaused = false;
            _timerHandle = setTimeout(_advanceTimerSentence, dur);
            return;
        }
    }
    // Anchor word found at or after active index — no drift detected, timer is fine
}

/**
 * Continuously advance to the next sentence after estimated duration.
 * Keeps going until TTS stops, boundary events take over, or we run
 * out of sentences.
 */
function _advanceTimerSentence() {
    if (!_timerRunning || _boundaryFired) {
        _stopTimerFallback();
        return;
    }

    // Safety: if a chunk-end pause fired just before this timeout ran, don't advance.
    // The timer will be rescheduled when the next chunk's 'start' fires.
    if (_timerPaused) return;

    // Move to the next sentence
    const nextIdx = _activeSentenceIndex + 1;
    if (nextIdx >= _sentenceSpans.length) {
        console.log('[Dooms TTS Highlight] Timer reached last sentence');
        _stopTimerFallback();
        return;
    }

    _setActiveSentence(nextIdx);

    // Estimate how long this sentence takes to speak, then schedule the next advance
    const sent = _sentenceSpans[nextIdx];
    const sentText = _timerFullText.substring(sent.start, sent.end);
    const durationMs = _estimateSentenceDurationMs(sentText, _timerSpeechRate, _calibratedMsPerWord);

    _timerRemainingMs = durationMs;
    _timerHandle = setTimeout(_advanceTimerSentence, durationMs);
}

// ─────────────────────────────────────────────
//  Message detection and sentence setup
// ─────────────────────────────────────────────

function _ensureSetupForCurrentMessage() {
    const mesEl = _findCurrentTtsMessage();
    if (!mesEl) return;

    // Already set up for this message
    if (mesEl === _activeMessage && _sentenceSpans.length > 0) return;

    _cleanup();
    _activeMessage = mesEl;

    const mesText = mesEl.querySelector('.mes_text');
    if (!mesText) return;

    // Check if bubble mode is active — bubbles wrap the content in .dooms-bubbles
    // When bubbles are active, we save the BUBBLE HTML so cleanup restores bubbles,
    // not the raw pre-bubble HTML (which would break the bubble display)
    const bubblesContainer = mesText.querySelector('.dooms-bubbles');
    _bubbleModeActive = !!bubblesContainer;

    if (_bubbleModeActive) {
        console.log('[Dooms TTS Highlight] Bubble mode detected — highlighting within bubble text');
    }

    // Split all sentences into spans
    _splitSentences(mesText);

    mesEl.classList.add('dooms-tts-active');

    console.log(`[Dooms TTS Highlight] Setup for message ${mesEl.getAttribute('mesid')} (${_sentenceSpans.length} sentences, bubbles: ${_bubbleModeActive})`);
}

function _findCurrentTtsMessage() {
    const stopBtn = document.querySelector('#chat .mes .mes_buttons .tts_play_button .fa-stop');
    if (stopBtn) {
        const mesEl = stopBtn.closest('.mes');
        if (mesEl) return mesEl;
    }

    const speakingEl = document.querySelector('#chat .mes.tts-speaking');
    if (speakingEl) return speakingEl;

    const allMes = document.querySelectorAll('#chat .mes[is_user="false"]');
    if (allMes.length > 0) {
        return allMes[allMes.length - 1];
    }

    return null;
}

// ─────────────────────────────────────────────
//  Poll: detect TTS stop for cleanup
// ─────────────────────────────────────────────

function _getMode() {
    return extensionSettings.ttsHighlightMode || 'off';
}

function _pollTtsState() {
    if (_getMode() === 'off') return;

    const isSpeaking = _isTtsSpeaking();

    if (isSpeaking && !_wasSpeaking) {
        _wasSpeaking = true;
        // Ensure sentence setup happens even for audio-based TTS
        // (the monkey-patch only covers speechSynthesis.speak)
        if (!_activeMessage || _sentenceSpans.length === 0) {
            _ensureSetupForCurrentMessage();
            // If no boundary events will fire (audio TTS), start timer fallback
            if (_sentenceSpans.length > 0 && _activeSentenceIndex < 0) {
                _setActiveSentence(0);
                // Start timer-based sentence progression for audio TTS
                // (speechSynthesis monkey-patch won't fire for API-based providers)
                const mesTextEl = _activeMessage ? _activeMessage.querySelector('.mes_text') : null;
                if (mesTextEl && !_timerRunning && !_boundaryFired) {
                    const fullVisibleText = _getVisibleText(mesTextEl);
                    _startTimerFallback(1, fullVisibleText);
                }
            }
        }
    } else if (!isSpeaking && _wasSpeaking) {
        _wasSpeaking = false;
        console.log('[Dooms TTS Highlight] TTS may have stopped — waiting for confirmation');
        // Longer grace period to avoid premature cleanup between audio chunks
        setTimeout(() => {
            if (!_isTtsSpeaking()) {
                console.log('[Dooms TTS Highlight] TTS confirmed stopped — cleaning up');
                _cleanup();
            } else {
                // TTS resumed (next chunk), re-flag as speaking
                _wasSpeaking = true;
            }
        }, 1000);
    }
}

function _isTtsSpeaking() {
    if ('speechSynthesis' in window && speechSynthesis.speaking) {
        return true;
    }
    const audioEl = document.getElementById('tts_audio');
    if (audioEl && !audioEl.paused && audioEl.src && audioEl.src !== '' && !audioEl.src.endsWith('silence.mp3')) {
        return true;
    }
    // Check the global TTS media control icon
    const mediaCtrl = document.getElementById('tts_media_control');
    if (mediaCtrl && mediaCtrl.classList.contains('fa-stop-circle')) {
        return true;
    }
    // Check per-message stop button (fa-stop inside tts_play_button)
    const stopBtn = document.querySelector('#chat .mes .tts_play_button .fa-stop');
    if (stopBtn) {
        return true;
    }
    return false;
}

// ─────────────────────────────────────────────
//  Cleanup — restore original DOM
// ─────────────────────────────────────────────

function _cleanup() {
    _stopTimerFallback();

    // Restore original message HTML
    if (_activeMessage && _originalMesTextHTML) {
        const mesText = _activeMessage.querySelector('.mes_text');
        if (mesText) {
            mesText.innerHTML = _originalMesTextHTML;
        }
    }

    if (_activeMessage) {
        _activeMessage.classList.remove('dooms-tts-active');
        // Remove bubble-TTS speaking classes if we added them
        _activeMessage.classList.remove('dooms-bubble-tts-speaking');
        _activeMessage.classList.remove('tts-speaking');
    }

    // Also clean up any stray bubble-tts-speaking classes on other messages
    document.querySelectorAll('#chat .mes.dooms-bubble-tts-speaking').forEach(el => {
        el.classList.remove('dooms-bubble-tts-speaking');
        el.classList.remove('tts-speaking');
    });

    _sentenceSpans = [];
    _activeSentenceIndex = -1;
    _activeMessage = null;
    _boundaryFired = false;
    _originalMesTextHTML = '';
    _chunkCounter = 0;
    _bubbleModeActive = false;
    // Reset per-message calibration state
    _calibratedMsPerWord = 310;
    _lastChunkStartTime = 0;
    _lastChunkWordCount = 0;
}
