#!/usr/bin/env node
/**
 * Unit tests for the DOM-free parts of DES voices
 * (docs/google-tts-voices-plan.md §14.1):
 *   segments.js       — merge / split / cap / "continue" diff
 *   presence.js       — the Present Characters scene rule, read-only
 *   voiceResolver.js  — which voice reads each line, and why
 *   voiceSettings.js  — load-time defaults and repair
 *   stAutoReadGuard.js — pausing SillyTavern's auto-read without changing its saved setting
 *   wav.js            — wrapping Gemini's raw PCM so browsers can play it
 *
 * None of these modules import SillyTavern, so this runs in plain Node.
 *
 * Usage:  node tools/voice-logic-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { strict as assert } from 'node:assert';

const seg = await import('../src/systems/voices/segments.js');
const presence = await import('../src/systems/voices/presence.js');
const resolver = await import('../src/systems/voices/voiceResolver.js');
const settings = await import('../src/systems/voices/voiceSettings.js');
const guard = await import('../src/systems/voices/stAutoReadGuard.js');
const catalog = await import('../src/systems/voices/voiceCatalog.js');
const wav = await import('../src/systems/voices/wav.js');

let failures = 0;
let passes = 0;
function test(name, fn) {
    try {
        fn();
        passes++;
    } catch (e) {
        failures++;
        console.error(`FAIL: ${name}\n  ${e?.stack || e}`);
    }
}

// ─── segments.js ────────────────────────────────────────────────────────────

test('normalize: cleans whitespace, drops empty and punctuation-only segments', () => {
    const out = seg.normalizeSegments([
        { speaker: null, kind: 'narration', text: '  The door\n\n opens.  ' },
        { speaker: 'Mara', kind: 'dialogue', text: '   ' },
        { speaker: 'Mara', kind: 'dialogue', text: '…' },
    ]);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { speaker: null, kind: 'narration', text: 'The door opens.', idxs: [] });
});

test('normalize: merges neighbours with the same voice, keeps bubble indexes', () => {
    const out = seg.normalizeSegments([
        { speaker: 'Mara', kind: 'dialogue', text: '"Hi."', idx: 0 },
        { speaker: 'mara', kind: 'dialogue', text: '"Again."', idx: 1 },
        { speaker: null, kind: 'narration', text: 'She waves.', idx: 2 },
        { speaker: null, kind: 'narration', text: 'Tom nods.', idx: 3 },
        { speaker: 'Tom', kind: 'dialogue', text: '"Yo."', idx: 4 },
    ]);
    assert.equal(out.length, 3);
    assert.equal(out[0].text, '"Hi." "Again."');
    assert.deepEqual(out[0].idxs, [0, 1]);
    assert.equal(out[1].text, 'She waves. Tom nods.');
    assert.deepEqual(out[1].idxs, [2, 3]);
    assert.equal(out[2].speaker, 'Tom');
});

test('normalize: narration never carries a speaker; dialogue speakers go through the resolver', () => {
    const out = seg.normalizeSegments([
        { speaker: 'Mara', kind: 'narration', text: 'Narration.' },
        { speaker: 'Mar', kind: 'dialogue', text: '"Line."' },
        { speaker: 'Ghost', kind: 'dialogue', text: '"Boo."' },
    ], { resolveSpeaker: (n) => (n === 'Mar' ? 'Mara' : n === 'Ghost' ? null : n) });
    assert.equal(out[0].speaker, null);
    assert.equal(out[1].speaker, 'Mara');
    assert.equal(out[2].speaker, null);
    assert.equal(out[2].kind, 'dialogue');
});

test('split: long text breaks at sentence ends under the limit', () => {
    const sentence = 'This is a sentence of moderate length. ';
    const long = sentence.repeat(200).trim();
    const parts = seg.splitLongText(long, 500);
    assert.ok(parts.length > 1);
    for (const p of parts) {
        assert.ok(p.length <= 500, `part too long: ${p.length}`);
        assert.ok(p.endsWith('.'), 'should end at a sentence');
    }
    assert.equal(parts.join(' '), long);
});

test('split: text with no sentence ends still splits on words', () => {
    const long = 'word '.repeat(300).trim();
    const parts = seg.splitLongText(long, 100);
    assert.ok(parts.every(p => p.length <= 100));
    assert.equal(parts.join(' '), long);
});

test('cap: past the limit the tail is merged into one Narrator segment', () => {
    const raw = [];
    for (let i = 0; i < 10; i++) raw.push({ speaker: i % 2 ? 'A' : 'B', kind: 'dialogue', text: `line ${i}`, idx: i });
    const out = seg.normalizeSegments(raw, { maxSegments: 4 });
    assert.equal(out.length, 4);
    assert.equal(out[3].speaker, null);
    assert.equal(out[3].kind, 'narration');
    assert.equal(out[3].text, 'line 3 line 4 line 5 line 6 line 7 line 8 line 9');
    assert.deepEqual(out[3].idxs, [3, 4, 5, 6, 7, 8, 9]);
});

test('continue: only the new text is read', () => {
    const before = seg.normalizeSegments([
        { speaker: null, kind: 'narration', text: 'Rain fell.' },
        { speaker: 'Mara', kind: 'dialogue', text: '"Come in."' },
    ]);
    const after = seg.normalizeSegments([
        { speaker: null, kind: 'narration', text: 'Rain fell.' },
        { speaker: 'Mara', kind: 'dialogue', text: '"Come in." "Quickly."' },
        { speaker: null, kind: 'narration', text: 'The door shut.' },
    ]);
    const fresh = seg.dropAlreadyRead(after, seg.joinSegmentText(before));
    assert.deepEqual(fresh.map(s => s.text), ['"Quickly."', 'The door shut.']);
    assert.equal(fresh[0].speaker, 'Mara');
});

test('continue: a changed message is read from the point it diverges', () => {
    const now = seg.normalizeSegments([
        { speaker: null, kind: 'narration', text: 'Something else entirely.' },
    ]);
    const fresh = seg.dropAlreadyRead(now, 'Rain fell.');
    assert.equal(fresh.length, 1);
});

test('hashText is stable and distinguishes texts', () => {
    assert.equal(seg.hashText('abc'), seg.hashText('abc'));
    assert.notEqual(seg.hashText('abc'), seg.hashText('abd'));
});

// ─── presence.js ────────────────────────────────────────────────────────────

const parse = (raw) => (typeof raw === 'string' ? JSON.parse(raw) : raw);
const tracker = (names, extra = {}) => JSON.stringify({
    characters: names.map(n => ({ name: n, thoughts: extra[n] || 'thinking' })),
});
const swipeMsg = (raw) => ({ is_user: false, swipe_id: 0, extra: { dooms_tracker_swipes: { 0: { characterThoughts: raw } } } });

test('tracker for a message: own swipe data wins', () => {
    const chat = [swipeMsg(tracker(['A'])), { is_user: true }, swipeMsg(tracker(['B']))];
    assert.equal(presence.trackerRawForMessage(chat, 2, tracker(['LIVE'])), tracker(['B']));
    assert.equal(presence.trackerRawForMessage(chat, 0, tracker(['LIVE'])), tracker(['A']));
});

test('tracker for a message: newest AI message without data uses the live tracker', () => {
    const chat = [swipeMsg(tracker(['A'])), { is_user: true }, { is_user: false, swipe_id: 0, extra: {} }];
    assert.equal(presence.trackerRawForMessage(chat, 2, tracker(['LIVE'])), tracker(['LIVE']));
});

test('tracker for a message: older message without data walks back, not to the live tracker', () => {
    const chat = [swipeMsg(tracker(['A'])), { is_user: false, swipe_id: 0, extra: { dooms_tracker_swipes: { 0: { characterThoughts: null } } } }, swipeMsg(tracker(['C']))];
    assert.equal(presence.trackerRawForMessage(chat, 1, tracker(['LIVE'])), tracker(['A']));
});

test('tracker for a message: swipe_info fallback', () => {
    const msg = { is_user: false, swipe_id: 1, extra: {}, swipe_info: [{}, { extra: { dooms_tracker_swipes: { 1: { characterThoughts: tracker(['S']) } } } }] };
    assert.equal(presence.trackerRawForMessage([msg], 0, null), tracker(['S']));
});

test('present names: off-scene, pending decisions and aliases', () => {
    const raw = tracker(['Mara', 'Tom', 'Vex', 'Mar'], { Vex: 'She is not currently in the scene.' });
    const names = presence.presentNames(raw, {
        parse,
        resolveName: (n) => (n === 'Mar' ? 'Mara' : n),
        pendingAlias: (n) => n === 'Tom',
    });
    assert.deepEqual([...names].sort(), ['mara']);
});

test('present names: legacy "- Name" text format', () => {
    const names = presence.presentNames('Present:\n- Mara\n- Tom\n- key: value', { parse: () => { throw new Error('not json'); }, resolveName: n => n });
    assert.deepEqual([...names].sort(), ['mara', 'tom']);
});

function ctx(overrides = {}) {
    return {
        presentLower: new Set(['mara', 'tom']),
        hiddenLower: new Set(),
        personaLower: new Set(['jordan']),
        activePersonaLower: 'jordan',
        showUserInPCP: false,
        resolveName: (n) => n,
        ...overrides,
    };
}

test('isPresentOnPanel: present, absent, case-insensitive', () => {
    assert.equal(presence.isPresentOnPanel('Mara', ctx()), true);
    assert.equal(presence.isPresentOnPanel('MARA', ctx()), true);
    assert.equal(presence.isPresentOnPanel('Vex', ctx()), false);
    assert.equal(presence.isPresentOnPanel('', ctx()), false);
});

test('isPresentOnPanel: removed/banned characters are absent even if the tracker lists them', () => {
    assert.equal(presence.isPresentOnPanel('Tom', ctx({ hiddenLower: new Set(['tom']) })), false);
});

test('isPresentOnPanel: persona only while "Show me in Present Characters" is on', () => {
    assert.equal(presence.isPresentOnPanel('Jordan', ctx()), false);
    assert.equal(presence.isPresentOnPanel('Jordan', ctx({ showUserInPCP: true })), true);
    // Other personas never count as NPCs on the panel.
    assert.equal(presence.isPresentOnPanel('Mara', ctx({ personaLower: new Set(['mara', 'jordan']) })), false);
});

test('isPresentOnPanel: alias resolution', () => {
    assert.equal(presence.isPresentOnPanel('Mar', ctx({ resolveName: n => (n === 'Mar' ? 'Mara' : n) })), true);
});

test('presence helpers never write to their inputs', () => {
    const frozenChat = Object.freeze([Object.freeze(swipeMsg(tracker(['A'])))]);
    presence.trackerRawForMessage(frozenChat, 0, null);
    const c = ctx();
    Object.freeze(c.presentLower); Object.freeze(c);
    presence.isPresentOnPanel('Mara', c);
});

// ─── voiceResolver.js ───────────────────────────────────────────────────────

const narrator = { source: 'stock', id: 'Charon' };

test('resolve: narration always gets the Narrator', () => {
    const r = resolver.resolveVoice({ seg: { kind: 'narration', speaker: null }, present: true, ref: { id: 'Kore' }, narrator });
    assert.deepEqual(r, { ref: { source: 'stock', id: 'Charon' }, reason: 'narration' });
});

test('resolve: unattributed / not present / no voice → Narrator with the reason', () => {
    assert.equal(resolver.resolveVoice({ seg: { kind: 'dialogue', speaker: null }, present: false, ref: null, narrator }).reason, 'unattributed');
    const notHere = resolver.resolveVoice({ seg: { kind: 'dialogue', speaker: 'Vex' }, present: false, ref: { source: 'stock', id: 'Puck' }, narrator });
    assert.equal(notHere.reason, 'not-in-scene');
    assert.equal(notHere.ref.id, 'Charon');
    assert.equal(resolver.resolveVoice({ seg: { kind: 'dialogue', speaker: 'Tom' }, present: true, ref: null, narrator }).reason, 'no-voice');
});

test('resolve: present character with a stock voice uses it (thoughts too)', () => {
    const r = resolver.resolveVoice({ seg: { kind: 'dialogue', speaker: 'Mara' }, present: true, ref: { source: 'stock', id: 'kore' }, narrator });
    assert.deepEqual(r, { ref: { source: 'stock', id: 'Kore' }, reason: 'character' });
    const t = resolver.resolveVoice({ seg: { kind: 'thought', speaker: 'Mara' }, present: true, ref: { source: 'stock', id: 'Kore' }, narrator });
    assert.equal(t.reason, 'character');
});

test('resolve: a non-stock voice without the direct route falls back (fallbackStock, then Narrator)', () => {
    const withFallback = resolver.resolveVoice({ seg: { kind: 'dialogue', speaker: 'Mara' }, present: true, ref: { source: 'designed', id: 'voice_abc', fallbackStock: 'Leda' }, narrator });
    assert.deepEqual(withFallback, { ref: { source: 'stock', id: 'Leda' }, reason: 'needs-key' });
    const without = resolver.resolveVoice({ seg: { kind: 'dialogue', speaker: 'Mara' }, present: true, ref: { source: 'designed', id: 'voice_abc' }, narrator });
    assert.equal(without.ref.id, 'Charon');
    assert.equal(without.reason, 'needs-key');
});

test('resolve: an unplayable Narrator falls back to Charon', () => {
    const r = resolver.resolveVoice({ seg: { kind: 'narration' }, present: false, ref: null, narrator: { source: 'stock', id: 'NotAVoice' } });
    assert.equal(r.ref.id, 'Charon');
    const r2 = resolver.resolveVoice({ seg: { kind: 'narration' }, present: false, ref: null, narrator: null });
    assert.equal(r2.ref.id, 'Charon');
});

test('lookupByName is case-insensitive and prefers an exact key', () => {
    const store = { Mara: 1, mara: 2, Tom: 3 };
    assert.equal(resolver.lookupByName(store, 'Mara'), 1);
    assert.equal(resolver.lookupByName(store, 'TOM'), 3);
    assert.equal(resolver.lookupByName(store, 'Nobody'), undefined);
    assert.equal(resolver.lookupByName(null, 'Tom'), undefined);
});

test('catalog: 30 voices, Google spelling, case-insensitive lookup', () => {
    assert.equal(catalog.STOCK_VOICES.length, 30);
    assert.equal(new Set(catalog.STOCK_VOICES.map(v => v.id)).size, 30);
    assert.equal(catalog.canonicalStockId('callirrhoe'), 'Callirrhoe');
    assert.equal(catalog.isStockVoice('Callirhoe'), false);
    assert.equal(catalog.stockLabel('kore'), 'Kore — Firm');
});

// ─── voiceSettings.js ───────────────────────────────────────────────────────

test('settings: a blob without voices gets the full defaults', () => {
    const live = {};
    assert.equal(settings.ensureVoiceSettings({}, live), true);
    assert.deepEqual(live.voices, settings.defaultVoiceSettings());
    assert.deepEqual(live.characterVoices, {});
});

test('settings: missing sub-keys are filled, existing ones are never clobbered', () => {
    const saved = { voices: { enabled: true, narratorVoice: { source: 'stock', id: 'Kore' } }, characterVoices: { Mara: { source: 'stock', id: 'Puck' } } };
    const live = { voices: saved.voices, characterVoices: saved.characterVoices };
    settings.ensureVoiceSettings(saved, live);
    assert.equal(live.voices.enabled, true);
    assert.equal(live.voices.narratorVoice.id, 'Kore');
    assert.equal(live.voices.autoRead, false);
    assert.equal(live.voices.model, 'gemini-3.8-flash-lite-tts');
    assert.deepEqual(live.characterVoices.Mara, { source: 'stock', id: 'Puck' });
    assert.equal(settings.ensureVoiceSettings(saved, live), false, 'second run changes nothing');
});

test('settings: broken shapes are repaired', () => {
    const saved = { voices: { narratorVoice: 'Kore', model: 'no-such-model' }, characterVoices: { A: 'Kore', B: { id: '' }, C: { source: 'stock', id: 'Leda' } } };
    const live = { voices: saved.voices, characterVoices: saved.characterVoices };
    assert.equal(settings.ensureVoiceSettings(saved, live), true);
    assert.equal(live.voices.narratorVoice.id, 'Charon');
    assert.equal(live.voices.model, 'gemini-3.8-flash-lite-tts');
    assert.deepEqual(Object.keys(live.characterVoices), ['C']);
    const live2 = { characterVoices: [] };
    settings.ensureVoiceSettings({ voices: {} }, live2);
    assert.deepEqual(live2.characterVoices, {});
});

// ─── stAutoReadGuard.js ─────────────────────────────────────────────────────

test('guard: SillyTavern sees false while active, the real value otherwise', () => {
    const tts = { enabled: true, auto_generation: true, voiceMap: {} };
    let active = true;
    assert.equal(guard.installStAutoReadGuard(tts, () => active), true);
    assert.equal(tts.auto_generation, false);
    active = false;
    assert.equal(tts.auto_generation, true);
    guard.uninstallStAutoReadGuard();
});

test('guard: the user\'s checkbox is recorded and saved to disk unchanged', () => {
    const tts = { enabled: true, auto_generation: true };
    guard.installStAutoReadGuard(tts, () => true);
    assert.equal(JSON.parse(JSON.stringify({ tts })).tts.auto_generation, true, 'disk keeps the real value');
    tts.auto_generation = false; // user unticks it in SillyTavern
    assert.equal(tts.auto_generation, false);
    assert.equal(JSON.parse(JSON.stringify(tts)).auto_generation, false);
    tts.auto_generation = true;
    assert.equal(JSON.parse(JSON.stringify(tts)).auto_generation, true);
    assert.equal(Object.keys(tts).includes('toJSON'), false, 'toJSON is not enumerable');
    guard.uninstallStAutoReadGuard();
});

test('guard: uninstall restores a plain property with the real value', () => {
    const tts = { auto_generation: true };
    guard.installStAutoReadGuard(tts, () => true);
    tts.auto_generation = false;
    guard.uninstallStAutoReadGuard();
    const desc = Object.getOwnPropertyDescriptor(tts, 'auto_generation');
    assert.equal(desc.get, undefined);
    assert.equal(tts.auto_generation, false);
    assert.equal(tts.toJSON, undefined);
    assert.equal(guard.isStAutoReadGuarded(), false);
});

test('guard: install is idempotent and survives a missing tts object', () => {
    assert.equal(guard.installStAutoReadGuard(undefined, () => true), false);
    const tts = { auto_generation: true };
    guard.installStAutoReadGuard(tts, () => true);
    guard.installStAutoReadGuard(tts, () => true);
    assert.equal(JSON.parse(JSON.stringify(tts)).auto_generation, true);
    guard.uninstallStAutoReadGuard();
    assert.equal(tts.auto_generation, true);
});

// ─── wav.js ─────────────────────────────────────────────────────────────────

test('wav: header describes 24 kHz mono 16-bit PCM and carries the samples', () => {
    const pcm = new Uint8Array([1, 0, 2, 0, 3, 0]);
    const out = wav.pcm16ToWav(pcm, 24000);
    const view = new DataView(out.buffer);
    const str = (o, n) => String.fromCharCode(...out.slice(o, o + n));
    assert.equal(str(0, 4), 'RIFF');
    assert.equal(view.getUint32(4, true), 36 + 6);
    assert.equal(str(8, 4), 'WAVE');
    assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint32(24, true), 24000);
    assert.equal(view.getUint32(28, true), 48000);
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(str(36, 4), 'data');
    assert.equal(view.getUint32(40, true), 6);
    assert.deepEqual([...out.slice(44)], [1, 0, 2, 0, 3, 0]);
});

test('wav: odd byte counts are trimmed to whole samples', () => {
    const out = wav.pcm16ToWav(new Uint8Array([1, 2, 3]), 16000);
    assert.equal(out.length, 44 + 2);
});

test('wav: mime helpers', () => {
    assert.equal(wav.sampleRateFromMime('audio/L16;codec=pcm;rate=24000'), 24000);
    assert.equal(wav.sampleRateFromMime('audio/L16;rate=16000'), 16000);
    assert.equal(wav.sampleRateFromMime('audio/wav'), 24000);
    assert.equal(wav.isRawPcm('audio/L16;codec=pcm;rate=24000'), true);
    assert.equal(wav.isRawPcm('audio/wav'), false);
    assert.deepEqual([...wav.base64ToBytes(Buffer.from([0, 255, 7]).toString('base64'))], [0, 255, 7]);
});

console.log(`voice-logic-test: ${passes} passed${failures ? `, ${failures} FAILED` : ''}`);
process.exit(failures ? 1 : 0);
