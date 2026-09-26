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
 * and the Google key box (with a key, voices call Google directly — Google
 * is stubbed there too, so any key string works; without one they go
 * through SillyTavern).
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
    sessionStorage.removeItem('dooms_voices_probe');
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

  // ── Google key box: direct calls to Google ──
  reject38 = false;
  let google = [];
  let googleMode = 'ok'; // 'ok' | 'reject-voice-field' | 'reject-model' | 'bad-key'
  const pcm = Buffer.alloc(2400).toString('base64');
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    const body = JSON.parse(req.postData());
    const model = /models\/([^:]+):generateContent/.exec(req.url())[1];
    const vc = body.generationConfig.speechConfig.voiceConfig;
    const shape = vc.voice ? 'voice' : 'prebuilt';
    google.push({ model, shape, key: req.headers()['x-goog-api-key'], text: body.contents[0].parts[0].text, voice: vc.voice || vc.prebuiltVoiceConfig.voiceName });
    const cors = { 'access-control-allow-origin': '*' };
    const fail = (status, message, st) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: { code: status, message, status: st } }) });
    if (googleMode === 'bad-key') return fail(400, 'API key not valid. Please pass a valid API key.', 'INVALID_ARGUMENT');
    if (googleMode === 'reject-voice-field' && shape === 'voice') return fail(400, 'Invalid JSON payload received. Unknown name "voice" at \'generation_config.speech_config.voice_config\'', 'INVALID_ARGUMENT');
    if (googleMode === 'reject-model' && model.startsWith('gemini-3.8')) return fail(404, `models/${model} is not found for API version v1beta`, 'NOT_FOUND');
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm } }] } }] }) });
  });
  const setKey = (key) => page.evaluate(async ({ DES, key }) => {
    (await import(`${DES}/src/core/state.js`)).extensionSettings.voices.googleApiKey = key;
    (await import(`${DES}/src/systems/voices/transport.js`)).clearRouteProbe();
  }, { DES, key });
  let n = 0;
  const say = async () => { n++; await page.evaluate(async ({ DES, n }) => {
    const engine = await import(`${DES}/src/systems/voices/voiceEngine.js`);
    engine.audition({ source: 'stock', id: 'Kore' }, `Key test line ${n}.`);
  }, { DES, n }); await page.waitForTimeout(1200); };

  // The key box saves into DES settings.
  await page.evaluate(() => {
    const el = document.querySelector('#rpg-voices-key');
    el.value = '  AIzaFAKE-direct-key  ';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const savedKey = await page.evaluate(async (DES) => (await import(`${DES}/src/core/state.js`)).extensionSettings.voices.googleApiKey, DES);
  check('key box saves the trimmed key to DES settings', () => assert.strictEqual(savedKey, 'AIzaFAKE-direct-key'));

  requests = []; google = [];
  await setKey('AIzaFAKE-direct-key');
  await say();
  check('with a key, voices call Google directly (not SillyTavern)', () => { assert.strictEqual(requests.length, 0); assert.strictEqual(google.length, 1); });
  check('the key is sent as x-goog-api-key and 3.8 uses voiceConfig.voice', () => {
    assert.strictEqual(google[0].key, 'AIzaFAKE-direct-key');
    assert.strictEqual(google[0].model, 'gemini-3.8-flash-lite-tts');
    assert.strictEqual(google[0].shape, 'voice');
    assert.strictEqual(google[0].voice, 'Kore');
  });
  const played = await page.evaluate(() => { const a = document.getElementById('dooms-tts-audio'); return a && a.error ? 'error ' + a.error.code : 'ok'; });
  check('Google\'s raw PCM is wrapped so the browser can play it', () => assert.strictEqual(played, 'ok'));

  google = []; googleMode = 'reject-voice-field';
  await setKey('AIzaFAKE-direct-key');
  await say(); await say();
  check('if 3.8 rejects voiceConfig.voice, prebuiltVoiceConfig is tried and remembered', () => {
    assert.deepStrictEqual(google.map(g => g.shape), ['voice', 'prebuilt', 'prebuilt']);
    assert.ok(google.every(g => g.model === 'gemini-3.8-flash-lite-tts'));
  });

  google = []; googleMode = 'reject-model';
  await setKey('AIzaFAKE-direct-key');
  await say(); await say();
  check('if Google rejects 3.8, voices fall back to 3.1 and remember it', () => {
    assert.deepStrictEqual(google.map(g => g.model), ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-3.1-flash-tts-preview']);
  });
  const statusDowngrade = await page.evaluate(() => document.querySelector('#rpg-voices-status')?.textContent || '');
  check('status line says the key is used directly and names the fallback', () => { assert.match(statusDowngrade, /key above/); assert.match(statusDowngrade, /3\.1/); });

  google = []; googleMode = 'bad-key';
  await setKey('AIzaFAKE-bad-key');
  await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await say();
  const badToast = await page.evaluate(() => [...document.querySelectorAll('.toast-message')].map(t => t.textContent).join(' | '));
  check('a bad key is not retried and the message points at the key box', () => { assert.strictEqual(google.length, 1); assert.match(badToast, /Settings → Voices/); });

  requests = []; google = []; googleMode = 'ok';
  await page.evaluate(() => document.querySelector('#rpg-voices-key-clear').click());
  await page.waitForTimeout(300);
  await say();
  check('clearing the key goes back to SillyTavern\'s saved key', () => { assert.strictEqual(google.length, 0); assert.strictEqual(requests.length, 1); });

  // Narrow settings panel: labels keep a readable width.
  const layout = await page.evaluate(() => {
    const sec = document.querySelector('.rpg-accordion-section[data-accordion="voices"]');
    let el = sec; while (el && el !== document.body) { if (getComputedStyle(el).display === 'none') el.style.display = 'block'; el = el.parentElement; }
    sec.classList.add('rpg-accordion-open');
    const prev = sec.style.width; sec.style.width = '380px';
    const widths = [...sec.querySelectorAll('.rpg-setting-label-group')].map(g => Math.round(g.getBoundingClientRect().width));
    const overflow = [...sec.querySelectorAll('select, input, button')].some(c => c.getBoundingClientRect().right > sec.getBoundingClientRect().right + 1);
    sec.style.width = prev;
    return { min: Math.min(...widths.filter(w => w > 0)), overflow };
  });
  check('Voices settings: labels stay readable in a narrow panel and nothing overflows', () => { assert.ok(layout.min >= 150, 'narrowest label ' + layout.min + 'px'); assert.strictEqual(layout.overflow, false); });
  await page.evaluate(() => { const sec = document.querySelector('.rpg-accordion-section[data-accordion="voices"]'); sec.style.width = '420px'; });
  await (await page.$('.rpg-accordion-section[data-accordion="voices"]')).screenshot({ path: shot('voices-settings-narrow.png') });
  await page.evaluate(() => { document.querySelector('.rpg-accordion-section[data-accordion="voices"]').style.width = ''; });

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
