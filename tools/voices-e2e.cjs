#!/usr/bin/env node
/**
 * End-to-end check of DES voices in a real SillyTavern, with Google stubbed.
 *
 * Every request DES sends to SillyTavern's Google TTS route
 * (/api/google/generate-native-tts) is intercepted, recorded and answered
 * with silent audio, so this needs no Google key and costs nothing. It
 * checks which voice each line gets (scene rule, Narrator fallback),
 * auto-read timing (once, after bubbles; never on re-render, stop, or chat
 * load; continue reads only the new part), the SillyTavern auto-read guard,
 * the Workshop Voice tab, the settings accordion, the 3.8 → 3.1 fallback,
 * and the Connection setting (a profile's saved Google key is used for the
 * voice request only, never for a chat generation, and is switched back).
 * It writes two throwaway Google keys ("DES e2e chat key", "DES e2e voices
 * key") and two connection profiles to that SillyTavern — use a test install.
 *
 * Setup: a local SillyTavern with this repo linked (or installed) as
 *   public/scripts/extensions/third-party/Dooms-Enhancement-Suite
 * and Playwright installed globally (npm i -g playwright). Creates a
 * character named "Storyteller" if it doesn't exist.
 *
 * Usage:  ST_URL=http://127.0.0.1:8000/ CHROME_PATH=/path/to/chrome node tools/voices-e2e.cjs
 * Exit:   0 = pass, 1 = a check failed or the page logged an error
 */
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
    ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
}
const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000/';
const CHROME_PATH = process.env.CHROME_PATH || undefined;
const assert = require('assert');

function silentWav(ms = 150) {
  const sr = 24000, n = Math.floor(sr * ms / 1000), data = Buffer.alloc(n * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const DES = '/scripts/extensions/third-party/Dooms-Enhancement-Suite';
const results = [];
const SHOTS = process.env.SHOT_DIR || require('os').tmpdir();
const shot = (name) => require('path').join(SHOTS, name);
function check(name, fn) { try { fn(); results.push('PASS ' + name); } catch (e) { results.push('FAIL ' + name + ': ' + e.message); } }

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });

  let requests = [];
  let reject38 = false;
  let trackKey = false;
  let ttsDelay = 60;
  const activeKeyLabel = () => page.evaluate(async () => {
    const r = await fetch('/api/secrets/read', { method: 'POST', headers: SillyTavern.getContext().getRequestHeaders() });
    return ((await r.json()).api_key_makersuite || []).find(s => s.active)?.label || null;
  });
  await page.route('**/api/google/generate-native-tts', async (route) => {
    const body = JSON.parse(route.request().postData());
    if (trackKey) body.activeKey = await activeKeyLabel();
    requests.push(body);
    if (reject38 && body.model.startsWith('gemini-3.8')) {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: `models/${body.model} is not found for API version v1beta, or is not supported for generateContent.` }) });
    }
    await new Promise(r => setTimeout(r, ttsDelay));
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav() });
  });

  await page.goto(ST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.SillyTavern?.getContext?.()?.eventSource, null, { timeout: 30000 });
  await page.waitForTimeout(6000);
  const closePopups = () => page.evaluate(() => {
    document.querySelectorAll('dialog.popup[open]').forEach(d => { try { d.close(); d.remove(); } catch (e) {} });
    document.querySelectorAll('.dooms-whats-new-overlay, #dooms-whats-new').forEach(el => el.remove());
  });
  await closePopups();

  // ── Character + chat ──
  await page.evaluate(async () => {
    const ctx = SillyTavern.getContext();
    if (!ctx.characters.some(c => c.name === 'Storyteller')) {
      const fd = new FormData();
      fd.append('ch_name', 'Storyteller');
      fd.append('first_mes', 'Welcome to the story.');
      fd.append('description', 'A narrator');
      const headers = ctx.getRequestHeaders(); delete headers['Content-Type'];
      const r = await fetch('/api/characters/create', { method: 'POST', headers, body: fd });
      if (!r.ok) throw new Error('create failed ' + r.status);
      await ctx.getCharacters();
    }
    const idx = SillyTavern.getContext().characters.findIndex(c => c.name === 'Storyteller');
    await SillyTavern.getContext().selectCharacterById(idx);
  });
  await page.waitForTimeout(3000);

  // ── Turn DES voices on ──
  const setup = await page.evaluate(async (DES) => {
    const st = await import(`${DES}/src/core/state.js`);
    const persistence = await import(`${DES}/src/core/persistence.js`);
    const boot = await import(`${DES}/src/systems/voices/voiceBoot.js`);
    const { extension_settings } = await import('/scripts/extensions.js');
    const s = st.extensionSettings;
    s.enableDialogueColoring = true;
    // Separate tracker mode, auto-update off: DES leaves the tracker this
    // test attaches to the message alone (together mode would re-parse the
    // reply text, find no tracker block and clear the scene).
    s.generationMode = 'separate';
    s.autoUpdate = false;
    s.chatBubbleMode = 'discord';
    s.voices.enabled = true;
    s.voices.autoRead = true;
    s.voices.narratorVoice = { source: 'stock', id: 'Charon' };
    s.characterVoices = { Mara: { source: 'stock', id: 'Kore' }, Vex: { source: 'stock', id: 'Puck' } };
    const colors = persistence.getActiveCharacterColors();
    Object.assign(colors, { Mara: '#ff0000', Tom: '#00ff00', Vex: '#0000ff' });
    const known = persistence.getActiveKnownCharacters();
    for (const n of ['Mara', 'Tom', 'Vex']) known[n] = known[n] || { emoji: '👤' };
    extension_settings.tts = extension_settings.tts || {};
    extension_settings.tts.auto_generation = true;
    await boot.syncVoicesState();
    return {
      stSees: extension_settings.tts.auto_generation,
      onDisk: JSON.parse(JSON.stringify(extension_settings.tts)).auto_generation,
      model: s.voices.model,
    };
  }, DES);
  check('ST auto-read is paused while DES voices are on', () => assert.strictEqual(setup.stSees, false));
  check('ST auto-read setting on disk is unchanged', () => assert.strictEqual(setup.onDisk, true));

  // ── Auto-read a new AI message ──
  const mesId = await page.evaluate(async () => {
    const ctx = SillyTavern.getContext();
    const tracker = JSON.stringify({ characters: [
      { name: 'Mara', thoughts: 'Hurry.' },
      { name: 'Tom', thoughts: 'Wet.' },
    ] });
    const msg = {
      name: 'Storyteller', is_user: false, is_system: false, send_date: Date.now(), swipe_id: 0, swipes: [],
      mes: 'The rain hammered the roof. <font color="#ff0000">"Come in, quickly,"</font> Mara said. <font color="#00ff00">"Right behind you,"</font> Tom muttered. <font color="#0000ff">"I\'m not even here,"</font> Vex whispered from the radio.',
      extra: { dooms_tracker_swipes: { 0: { characterThoughts: tracker } } },
    };
    msg.swipes = [msg.mes];
    ctx.chat.push(msg);
    ctx.addOneMessage(msg);
    const id = ctx.chat.length - 1;
    await ctx.eventSource.emit(ctx.eventTypes.GENERATION_STARTED, 'normal', {}, false);
    await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_RECEIVED, id, 'normal');
    await ctx.eventSource.emit(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, id, 'normal');
    return id;
  });
  await page.waitForTimeout(3500);
  const autoReq = requests.map(r => [r.voice, r.text]);
  console.log('auto-read requests:', JSON.stringify(autoReq, null, 1));
  check('auto-read made 3 requests (merged by voice)', () => assert.strictEqual(requests.length, 3));
  check('narration → Narrator (Charon)', () => assert.deepStrictEqual(autoReq[0], ['Charon', 'The rain hammered the roof.']));
  check('present Mara with a voice → Kore', () => { assert.strictEqual(autoReq[1][0], 'Kore'); assert.match(autoReq[1][1], /Come in, quickly/); });
  check('Tom (present, no voice) and Vex (voiced but not present) → Narrator', () => {
    assert.strictEqual(autoReq[2][0], 'Charon'); assert.match(autoReq[2][1], /Right behind you/); assert.match(autoReq[2][1], /not even here/);
  });
  check('requests use the chosen 3.8 model through ST route', () => assert.ok(requests.every(r => r.model === 'gemini-3.8-flash-lite-tts' && r.api === 'makersuite')));
  const bubbles = await page.evaluate((id) => document.querySelectorAll(`#chat .mes[mesid="${id}"] .dooms-bubble`).length, mesId);
  check('bubbles were applied before reading', () => assert.ok(bubbles >= 3, 'bubbles: ' + bubbles));
  const leftovers = await page.evaluate(() => document.querySelectorAll('.dooms-tts-speaking, .dooms-tts-loading').length);
  check('highlights are cleared after playback', () => assert.strictEqual(leftovers, 0));
  const msgBtn = await page.evaluate((id) => !!document.querySelector(`#chat .mes[mesid="${id}"] .dooms-message-tts`), mesId);
  check('DES message bullhorn injected', () => assert.ok(msgBtn));

  // ── Re-render (same message) must not read twice ──
  requests = [];
  await page.evaluate(async (id) => { const ctx = SillyTavern.getContext(); ctx.updateMessageBlock(id, ctx.chat[id]); await ctx.eventSource.emit(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, id, 'normal'); }, mesId);
  await page.waitForTimeout(1800);
  check('a re-render without a new generation does not auto-read', () => assert.strictEqual(requests.length, 0));

  // ── Stop mid-stream: the partial reply is not read ──
  requests = [];
  await page.evaluate(async (id) => {
    const ctx = SillyTavern.getContext();
    await ctx.eventSource.emit(ctx.eventTypes.GENERATION_STARTED, 'continue', {}, false);
    ctx.chat[id].mes += ' <font color="#ff0000">"And another thing."</font>';
    ctx.updateMessageBlock(id, ctx.chat[id]);
    await ctx.eventSource.emit(ctx.eventTypes.GENERATION_STOPPED);
    await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_RECEIVED, id, 'continue');
    await ctx.eventSource.emit(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, id, 'continue');
  }, mesId);
  await page.waitForTimeout(1800);
  check('a stopped generation is not auto-read', () => assert.strictEqual(requests.length, 0));

  // ── Continue: only the new part is read ──
  requests = [];
  await page.evaluate(async (id) => {
    const ctx = SillyTavern.getContext();
    await ctx.eventSource.emit(ctx.eventTypes.GENERATION_STARTED, 'continue', {}, false);
    ctx.chat[id].mes += ' <font color="#ff0000">"Last thing, I promise."</font>';
    ctx.updateMessageBlock(id, ctx.chat[id]);
    await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_RECEIVED, id, 'continue');
    await ctx.eventSource.emit(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, id, 'continue');
  }, mesId);
  await page.waitForTimeout(2500);
  console.log('continue requests:', JSON.stringify(requests.map(r => [r.voice, r.text])));
  check('continue reads only the new lines', () => {
    assert.ok(requests.length >= 1);
    assert.ok(requests.every(r => !/rain hammered/.test(r.text)), 'old text re-read');
    assert.ok(requests.some(r => /Last thing, I promise/.test(r.text) && r.voice === 'Kore'));
  });

  // ── Bubble "read from here" (cached → no new requests; highlights the bubble) ──
  requests = [];
  await closePopups();
  const bubbleSel = `#chat .mes[mesid="${mesId}"] .dooms-bubble-character`;
  await page.locator(bubbleSel).first().hover();
  await page.locator(`${bubbleSel} .dooms-bubble-tts`).first().click();
  const hl = await page.evaluate(async () => { await new Promise(r => setTimeout(r, 40)); return document.querySelectorAll('.dooms-bubble.dooms-tts-speaking, .dooms-bubble.dooms-tts-loading').length; });
  await page.waitForTimeout(1500);
  check('read-from-here reuses cached audio', () => assert.strictEqual(requests.length, 0));
  check('read-from-here highlights a bubble', () => assert.ok(hl >= 1));

  // ── Bubbles off: parse path gives the same voices ──
  requests = [];
  const offReq = await page.evaluate(async ({ DES, id }) => {
    const st = await import(`${DES}/src/core/state.js`);
    const bubblesMod = await import(`${DES}/src/systems/rendering/chatBubbles.js`);
    st.extensionSettings.chatBubbleMode = 'off';
    bubblesMod.revertAllChatBubbles();
    const engine = await import(`${DES}/src/systems/voices/voiceEngine.js`);
    engine.onChatChanged(); // clears the audio cache
    engine.speakMessage(id);
    await new Promise(r => setTimeout(r, 2000));
    return document.querySelectorAll(`#chat .mes[mesid="${id}"] .dooms-bubble`).length;
  }, { DES, id: mesId });
  console.log('bubbles-off requests:', JSON.stringify(requests.map(r => [r.voice, r.text])));
  check('bubbles off: bubbles reverted', () => assert.strictEqual(offReq, 0));
  check('bubbles off: same voice split', () => assert.deepStrictEqual(requests.map(r => r.voice), ['Charon', 'Kore', 'Charon', 'Kore']));

  // ── Hidden (removed) character loses their voice ──
  requests = [];
  await page.evaluate(async ({ DES, id }) => {
    const persistence = await import(`${DES}/src/core/persistence.js`);
    persistence.getActiveRemovedCharacters().push('Mara');
    const engine = await import(`${DES}/src/systems/voices/voiceEngine.js`);
    engine.onChatChanged();
    engine.speakMessage(id);
    await new Promise(r => setTimeout(r, 1500));
    const list = persistence.getActiveRemovedCharacters(); list.splice(list.indexOf('Mara'), 1);
  }, { DES, id: mesId });
  check('removed character is read by the Narrator', () => assert.deepStrictEqual(requests.map(r => r.voice), ['Charon']));

  // ── Workshop Voice tab ──
  requests = [];
  await page.evaluate(async (DES) => {
    const lazy = await import(`${DES}/src/core/lazyUI.js`);
    await lazy.ensureSettingsUI();
    window.dispatchEvent(new CustomEvent('dooms:open-workshop', { detail: { characterName: 'Tom' } }));
  }, DES);
  await page.waitForTimeout(1500);
  await page.click('#character-workshop-popup .workshop-nav button[data-pane="voice"]');
  await page.waitForSelector('#cw-voice-pane .cw-voice-card', { timeout: 5000 });
  const cardCount = await page.locator('#cw-voice-pane .cw-voice-card').count();
  check('Voice tab shows 30 standard voices', () => assert.strictEqual(cardCount, 30));
  await page.screenshot({ path: shot('workshop-voice-before.png') });
  await page.click('#cw-voice-pane .cw-voice-pick[data-voice="Puck"]');
  await page.waitForTimeout(800);
  check('picking a voice plays a preview in that voice', () => assert.ok(requests.some(r => r.voice === 'Puck' && /Hello, I'm Tom/.test(r.text)), JSON.stringify(requests)));
  const selected = await page.locator('#cw-voice-pane .cw-voice-card.is-selected').getAttribute('data-voice');
  check('picked voice is marked selected', () => assert.strictEqual(selected, 'Puck'));
  await page.screenshot({ path: shot('workshop-voice.png') });
  await page.setViewportSize({ width: 1081, height: 800 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('workshop-1081.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('workshop-phone.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('phone: no horizontal page scroll', () => assert.ok(overflow <= 0, 'overflow ' + overflow));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(300);
  await page.click('#cw-save');
  await page.waitForTimeout(800);
  const saved = await page.evaluate(async (DES) => (await import(`${DES}/src/core/state.js`)).extensionSettings.characterVoices.Tom, DES);
  check('Save stores Tom\'s voice', () => assert.deepStrictEqual(saved, { source: 'stock', id: 'Puck' }));

  // Tom now voiced
  requests = [];
  await page.evaluate(async ({ DES, id }) => {
    const engine = await import(`${DES}/src/systems/voices/voiceEngine.js`);
    engine.onChatChanged();
    engine.speakMessage(id);
    await new Promise(r => setTimeout(r, 2000));
  }, { DES, id: mesId });
  check('after saving, Tom speaks in Puck', () => assert.deepStrictEqual(requests.map(r => r.voice), ['Charon', 'Kore', 'Charon', 'Puck', 'Charon', 'Kore']));

  // ── Settings accordion ──
  await page.evaluate(() => {
    const el = document.querySelector('.rpg-accordion-section[data-accordion="voices"]');
    const popup = el && el.closest('[id]');
    return popup && popup.id;
  });
  const settingsState = await page.evaluate(() => ({
    enabled: document.querySelector('#rpg-voices-enabled')?.checked,
    narrator: document.querySelector('#rpg-voices-narrator')?.value,
    options: document.querySelectorAll('#rpg-voices-narrator option').length,
    model: document.querySelector('#rpg-voices-model')?.value,
    status: document.querySelector('#rpg-voices-status')?.textContent,
  }));
  console.log('settings:', JSON.stringify(settingsState));
  check('settings accordion bound', () => { assert.strictEqual(settingsState.options, 30); assert.strictEqual(settingsState.narrator, 'Charon'); });

  // ── 3.8 rejected by the ST route → falls back to 3.1 for the session ──
  requests = [];
  reject38 = true;
  await page.evaluate(async ({ DES, id }) => {
    sessionStorage.removeItem('dooms_voices_st_model');
    const engine = await import(`${DES}/src/systems/voices/voiceEngine.js`);
    engine.onChatChanged();
    engine.speakMessage(id);
    await new Promise(r => setTimeout(r, 2500));
  }, { DES, id: mesId });
  const models = requests.map(r => r.model);
  console.log('downgrade models:', JSON.stringify(models));
  check('rejected 3.8 retries once on 3.1, then stays on 3.1', () => {
    assert.strictEqual(models[0], 'gemini-3.8-flash-lite-tts');
    assert.ok(models.slice(1).every(m => m === 'gemini-3.1-flash-tts-preview'));
    assert.strictEqual(models.filter(m => m.startsWith('gemini-3.8')).length, 1);
  });

  // ── Connection profiles ──
  reject38 = false;
  // The simulated generations above never sent GENERATION_ENDED; real
  // SillyTavern always does. Without it the first key swap waits out the
  // 2 s idle fallback.
  await page.evaluate(async () => { const ctx = SillyTavern.getContext(); await ctx.eventSource.emit(ctx.eventTypes.GENERATION_ENDED, ctx.chat.length); });
  await page.evaluate(() => sessionStorage.removeItem('dooms_voices_st_model'));
  const ids = await page.evaluate(async () => {
    const ctx = SillyTavern.getContext();
    const write = async (value, label) => (await (await fetch('/api/secrets/write', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ key: 'api_key_makersuite', value, label }) })).json()).id;
    const chatId = await write('AIzaFAKE-chat-key-000000000000', 'DES e2e chat key');
    const voicesId = await write('AIzaFAKE-voices-key-00000000000', 'DES e2e voices key');
    await fetch('/api/secrets/rotate', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ key: 'api_key_makersuite', id: chatId }) });
    const ext = ctx.extensionSettings;
    ext.connectionManager = ext.connectionManager || { profiles: [] };
    ext.connectionManager.profiles = (ext.connectionManager.profiles || []).filter(p => !/^DES e2e/.test(p.name));
    ext.connectionManager.profiles.push(
      { id: 'des-e2e-voices', mode: 'cc', name: 'DES e2e Voices', api: 'google', 'secret-id': voicesId },
      { id: 'des-e2e-openai', mode: 'cc', name: 'DES e2e OpenAI', api: 'openai' },
    );
    return { chatId, voicesId };
  });
  const opts = await page.evaluate(async (DES) => {
    const ui = await import(`${DES}/src/systems/ui/voicesSettingsUI.js`);
    await ui.refreshVoicesConnectionOptions();
    return [...document.querySelectorAll('#rpg-voices-connection option')].map(o => ({ v: o.value, d: o.disabled }));
  }, DES);
  check('Connection dropdown lists Google profiles, disables others', () => {
    assert.deepStrictEqual(opts.find(o => o.v === 'DES e2e Voices'), { v: 'DES e2e Voices', d: false });
    assert.deepStrictEqual(opts.find(o => o.v === 'DES e2e OpenAI'), { v: 'DES e2e OpenAI', d: true });
    assert.strictEqual(opts[0].v, '');
  });

  const speak = (text) => page.evaluate(async ({ DES, id, text }) => {
    const engine = await import(`${DES}/src/systems/voices/voiceEngine.js`);
    engine.onChatChanged();
    engine.audition({ source: 'stock', id: 'Kore' }, text);
  }, { DES, id: mesId, text });

  requests = []; trackKey = true;
  await page.evaluate(async (DES) => { (await import(`${DES}/src/core/state.js`)).extensionSettings.voices.connectionProfile = ''; }, DES);
  await speak('Default connection.');
  await page.waitForTimeout(1200);
  check('default connection uses the active key', () => assert.deepStrictEqual(requests.map(r => r.activeKey), ['DES e2e chat key']));

  requests = [];
  await page.evaluate(async (DES) => { (await import(`${DES}/src/core/state.js`)).extensionSettings.voices.connectionProfile = 'DES e2e Voices'; }, DES);
  await speak('Profile connection.');
  await page.waitForTimeout(1500);
  check('profile connection uses the profile\'s key for the voice request', () => assert.deepStrictEqual(requests.map(r => r.activeKey), ['DES e2e voices key']));
  const afterKey = await activeKeyLabel();
  check('the chat key is active again afterwards', () => assert.strictEqual(afterKey, 'DES e2e chat key'));
  const marker = await page.evaluate(() => localStorage.getItem('dooms_voices_key_swap'));
  check('no crash marker left behind', () => assert.strictEqual(marker, null));

  // A chat generation that starts while a voice request holds the profile key
  // waits for the swap-back, and no new swap starts until it has finished.
  requests = []; ttsDelay = 1500;
  const holdResult = await page.evaluate(async ({ DES, id }) => {
    const ctx = SillyTavern.getContext();
    const engine = await import(`${DES}/src/systems/voices/voiceEngine.js`);
    const readActive = async () => ((await (await fetch('/api/secrets/read', { method: 'POST', headers: ctx.getRequestHeaders() })).json()).api_key_makersuite || []).find(s => s.active)?.label;
    engine.onChatChanged();
    engine.speakMessage(id);
    await new Promise(r => setTimeout(r, 700)); // first line is in flight on the profile key
    const during = await readActive();
    const t0 = Date.now();
    await ctx.eventSource.emit(ctx.eventTypes.GENERATION_STARTED, 'normal', {}, false);
    document.body.dataset.generating = 'true';
    const waited = Date.now() - t0;
    const atSend = await readActive();
    await new Promise(r => setTimeout(r, 2500)); // "generating": the next line must not swap
    const midGeneration = await readActive();
    delete document.body.dataset.generating;
    await ctx.eventSource.emit(ctx.eventTypes.GENERATION_ENDED, ctx.chat.length);
    return { during, waited, atSend, midGeneration };
  }, { DES, id: mesId });
  const beforeEnd = requests.length;
  await page.waitForTimeout(6000);
  console.log('hold:', JSON.stringify(holdResult), 'requests before end:', beforeEnd, 'after:', requests.length);
  check('during a voice request the profile key is active', () => assert.strictEqual(holdResult.during, 'DES e2e voices key'));
  check('a chat generation waits for the swap-back', () => { assert.ok(holdResult.waited >= 300, 'waited ' + holdResult.waited); assert.strictEqual(holdResult.atSend, 'DES e2e chat key'); });
  check('no key swap while generating', () => { assert.strictEqual(holdResult.midGeneration, 'DES e2e chat key'); assert.strictEqual(beforeEnd, 1); });
  check('voices resume after the generation ends', () => assert.ok(requests.length > 1 && requests.every(r => r.activeKey === 'DES e2e voices key')));
  ttsDelay = 60;
  await page.waitForTimeout(500);
  const restored = await activeKeyLabel();
  check('chat key restored after the hold test', () => assert.strictEqual(restored, 'DES e2e chat key'));

  // Crash mid-swap: the next load puts the chat key back.
  const recovered = await page.evaluate(async ({ DES, ids }) => {
    const ctx = SillyTavern.getContext();
    await fetch('/api/secrets/rotate', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ key: 'api_key_makersuite', id: ids.voicesId }) });
    localStorage.setItem('dooms_voices_key_swap', JSON.stringify({ key: 'api_key_makersuite', originalId: ids.chatId, at: Date.now() }));
    const boot = await import(`${DES}/src/systems/voices/voiceBoot.js`);
    await boot.syncVoicesState();
    return { marker: localStorage.getItem('dooms_voices_key_swap') };
  }, { DES, ids });
  const recoveredKey = await activeKeyLabel();
  check('interrupted swap is undone on the next load', () => { assert.strictEqual(recoveredKey, 'DES e2e chat key'); assert.strictEqual(recovered.marker, null); });

  // A profile that no longer exists: nothing is sent, the user is told.
  requests = [];
  await page.evaluate(async (DES) => { (await import(`${DES}/src/core/state.js`)).extensionSettings.voices.connectionProfile = 'DES e2e Gone'; }, DES);
  await speak('Missing profile.');
  await page.waitForTimeout(800);
  const toastText = await page.evaluate(() => [...document.querySelectorAll('.toast-message')].map(t => t.textContent).join(' | '));
  check('a missing profile sends nothing and says why', () => { assert.strictEqual(requests.length, 0); assert.match(toastText, /no longer exists/); });
  trackKey = false;

  // Clean up the throwaway keys and profiles.
  await page.evaluate(async (DES) => {
    const ctx = SillyTavern.getContext();
    (await import(`${DES}/src/core/state.js`)).extensionSettings.voices.connectionProfile = '';
    const state = await (await fetch('/api/secrets/read', { method: 'POST', headers: ctx.getRequestHeaders() })).json();
    for (const sec of (state.api_key_makersuite || []).filter(s => /^DES e2e/.test(s.label || ''))) {
      await fetch('/api/secrets/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ key: 'api_key_makersuite', id: sec.id }) });
    }
    const ext = ctx.extensionSettings;
    ext.connectionManager.profiles = ext.connectionManager.profiles.filter(p => !/^DES e2e/.test(p.name));
  }, DES);

  // ── Voices off: bullhorn goes back to /speak, guard removed ──
  const offState = await page.evaluate(async (DES) => {
    const st = await import(`${DES}/src/core/state.js`);
    const boot = await import(`${DES}/src/systems/voices/voiceBoot.js`);
    const { extension_settings } = await import('/scripts/extensions.js');
    st.extensionSettings.voices.enabled = false;
    await boot.syncVoicesState();
    return { stSees: extension_settings.tts.auto_generation, buttons: document.querySelectorAll('.dooms-message-tts').length };
  }, DES);
  check('voices off: ST auto-read restored', () => assert.strictEqual(offState.stSees, true));
  check('voices off: message bullhorns removed', () => assert.strictEqual(offState.buttons, 0));

  console.log(results.join('\n'));
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
  process.exit(results.some(r => r.startsWith('FAIL')) || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
