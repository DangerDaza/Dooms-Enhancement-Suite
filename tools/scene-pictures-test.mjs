/**
 * Scene pictures model tests (src/utils/scenePictures.js). Run: node tools/scene-pictures-test.mjs
 */
import * as S from '../src/utils/scenePictures.js';

let failures = 0;
function check(name, ok) { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`); if (!ok) failures++; }

// ── 1. Config ──
{
    const d = S.scenePicturesConfig({});
    check('defaults: off, the studio on 8791, card2, every 5, 12 messages, portrait', !d.enabled && d.studioUrl === 'http://127.0.0.1:8791' && d.card === 'card2' && d.every === 5 && d.window === 12 && d.size === 'portrait' && !d.toAI && d.narrator === 'Narrator');
    const c = S.scenePicturesConfig({ scenePictures: { enabled: true, studioUrl: ' http://localhost:9000/// ', card: 'card1', every: '0', window: 99, size: 'tall', steps: 8, cfg: '1', narrator: '  ', timeoutSec: 5, unet: ' kromoss ' } });
    check('normalised: url trimmed of slashes, card1, every clamps to 1, window to 40, a bad size falls back, narrator back to default, timeout to 20, unet trimmed', c.enabled && c.studioUrl === 'http://localhost:9000' && c.card === 'card1' && c.every === 1 && c.window === 40 && c.size === 'portrait' && c.steps === 8 && c.cfg === 1 && c.narrator === 'Narrator' && c.timeoutSec === 20 && c.unet === 'kromoss');
    check('sizeOf', S.sizeOf({ size: 'landscape' }).width === 1536 && S.sizeOf({ size: 'nope' }).id === 'portrait');
}

// ── 2. State and cadence ──
{
    const s0 = S.freshSceneState();
    check('fresh state', s0.sinceLast === 0 && !s0.retryNext && s0.loras.length === 0 && s0.last === null);
    let r = S.countTurn(s0, 'm1');
    check('a turn counts once', r.counted && r.state.sinceLast === 1 && !S.countTurn(r.state, 'm1').counted);
    let s = r.state;
    for (const k of ['m2', 'm3', 'm4']) s = S.countTurn(s, k).state;
    check('due at every', !S.pictureDue(s, 5) && S.pictureDue(S.countTurn(s, 'm5').state, 5) && S.pictureDue({ ...s, retryNext: true }, 5));
    const done = S.afterPicture(S.countTurn(s, 'm5').state, { at: 10, caption: 'c', file: 'f.png', url: '/user/images/x.png' });
    check('after a picture: count reset, last kept', done.sinceLast === 0 && !done.retryNext && done.last.ok && done.last.file === 'f.png' && done.lastKey === 'm5');
    const failed = S.afterFailure(done, { at: 11, error: 'timeout' });
    check('after a failure: retry armed, the last picture kept beside the error', failed.retryNext && !failed.last.ok && failed.last.error === 'timeout' && failed.last.file === 'f.png');
    const read = S.sceneStateOf({ sinceLast: '3', retryNext: 'yes', loras: ['A', { name: 'B', strength: 9 }, { name: 'a' }, ''], identity: 7, last: { at: '5', ok: true, caption: 'x' } });
    check('sceneStateOf normalises', read.sinceLast === 3 && read.retryNext === false && read.loras.length === 2 && read.loras[1].strength === 3 && read.identity === '' && read.last.at === 5 && read.last.ok && read.last.file === '');
    check('sceneStateOf from nothing', S.sceneStateOf(undefined).sinceLast === 0 && S.sceneStateOf(null).last === null);
}

// ── 3. LoRAs ──
{
    const l = S.parseLoraList('BunnySlop_MOSS:0.8\nFlat_Anime_Moss-Image-, moss_image_color_depth_control @ -1.5\n bunnyslop_moss : 2');
    check('parseLoraList: strength after : or @, bare at 1, duplicates (case aside) dropped', l.length === 3 && l[0].name === 'BunnySlop_MOSS' && l[0].strength === 0.8 && l[1].strength === 1 && l[2].strength === -1.5);
    check('formatLoraList round-trips', S.formatLoraList(l) === 'BunnySlop_MOSS:0.8\nFlat_Anime_Moss-Image-:1\nmoss_image_color_depth_control:-1.5' && S.parseLoraList(S.formatLoraList(l)).length === 3);
    check('normalizeLoras clamps and rounds', S.normalizeLoras([{ name: 'x', strength: 0.123456 }, { name: 'y', strength: -7 }])[0].strength === 0.12 && S.normalizeLoras([{ name: 'y', strength: -7 }])[0].strength === -3);
}

// ── 4. The caption ──
{
    const p = S.buildCaptionPrompt({ recent: 'Jordan: I step in.\nMara: She looks up.', present: ['Mara Vane'], identity: 'Mara: red hair in a braid, grey coat', guide: 'Never show weapons.', size: 'landscape' });
    check('the caption prompt: rules, frame, identity notes, the extra rule, the scene, who is present', p.system.includes('150 to 300 words') && p.system.includes('a wide landscape frame') && p.system.includes('Identity notes') && p.system.includes('red hair in a braid') && p.system.includes('Never show weapons.') && p.system.includes('never write a character\'s name') && p.user.includes('Jordan: I step in.') && p.user.includes('Characters present: Mara Vane.') && p.user.endsWith('Write the caption.'));
    check('no notes, no present: the lines are left out', !S.buildCaptionPrompt({ recent: 'x' }).system.includes('Identity notes') && !S.buildCaptionPrompt({ recent: 'x' }).user.includes('present'));
    check('parseCaptionReply: fences, label and quotes off, one line', S.parseCaptionReply('```\nCaption: "Anime-style digital illustration of a woman\nin a grey coat, standing in a market at dusk, looking up."\n```') === 'Anime-style digital illustration of a woman in a grey coat, standing in a market at dusk, looking up.');
    check('parseCaptionReply: angle brackets go, too short is nothing', !S.parseCaptionReply('<lora:x> hi').includes('<') && S.parseCaptionReply('short') === '' && S.parseCaptionReply('x'.repeat(2500)).length === 2000);
    check('captionLine: the first sentence, cut when long', S.captionLine('A tall frame. More words after.') === 'A tall frame.' && S.captionLine('w'.repeat(200)).length === 160);
}

// ── 5. The studio ──
{
    const cfg = S.scenePicturesConfig({ scenePictures: { studioUrl: 'http://127.0.0.1:8791/', card: 'card1', preamble: 'Anime-style digital illustration. ', unet: 'kromoss_v10_bf16' } });
    const e = S.studioEndpoints(cfg);
    check('endpoints', e.preflight === 'http://127.0.0.1:8791/api/preflight?card=card1' && e.generate === 'http://127.0.0.1:8791/api/generate' && e.image('MossStudio/2026-10-22/a b.png') === 'http://127.0.0.1:8791/api/image?f=MossStudio%2F2026-10-22%2Fa%20b.png');
    const body = S.buildGenerateBody(cfg, { loras: [{ name: 'BunnySlop_MOSS', strength: 0.8 }] }, 'a woman in a grey coat', { seed: 7, title: 'Scene 3' });
    check('generate body: positive with the preamble, size, sampling, loras, title, unet only when set', body.positive === 'Anime-style digital illustration. a woman in a grey coat' && body.width === 864 && body.height === 1536 && body.steps === 25 && body.cfg === 2.5 && body.sampler === 'er_sde' && body.seed === 7 && body.count === 1 && body.slg === true && body.loras[0].name === 'BunnySlop_MOSS' && body.title === 'Scene 3' && body.unet === 'kromoss_v10_bf16' && !('clip' in body) && !('character' in body));
    check('readJobId: job, nested job, prompt_id, nothing', S.readJobId({ id: 12 }) === '12' && S.readJobId({ job: { job_id: 'ab' } }) === 'ab' && S.readJobId({ prompt_id: 'p1' }) === 'p1' && S.readJobId(null) === '');
    const listDone = S.readJobs([{ id: 1, status: 'running' }, { id: 2, status: 'done', images: ['MossStudio/d/1.png'] }], 2);
    check('readJobs: a list, done with images', listDone.found && listDone.done && !listDone.failed && listDone.images[0] === 'MossStudio/d/1.png');
    check('readJobs: running', (() => { const r = S.readJobs({ jobs: [{ job_id: 'x', state: 'running' }] }, 'x'); return r.found && !r.done && !r.failed; })());
    check('readJobs: keyed store, images as objects, no status', (() => { const r = S.readJobs({ jobs: { k1: { images: [{ file: 'a.png' }] } } }, 'k1'); return r.found && r.done && r.images[0] === 'a.png'; })());
    check('readJobs: failed, and the prompt-as-status form', S.readJobs([{ id: 3, status: 'error', error: 'OOM' }], 3).failed && S.readJobs([{ id: 3, status: 'error', error: 'OOM' }], 3).error === 'OOM' && S.readJobs([{ id: 4, prompt: 'done', images: ['z'] }], 4).done);
    check('readJobs: unknown id', !S.readJobs([{ id: 1 }], 9).found && !S.readJobs(null, 9).found);
    check('readLoraNames: strings, objects, under loras or files', S.readLoraNames(['a', { name: 'b' }]).join() === 'a,b' && S.readLoraNames({ loras: [{ file: 'c.safetensors' }] }).join() === 'c.safetensors' && S.readLoraNames({}).length === 0);
    check('preflightLine', S.preflightLine({ reachable: true, version: '0.42.1', busy: true }) === 'Moss Studio answers (ComfyUI 0.42.1, busy rendering).' && S.preflightLine({ reachable: false }).startsWith('Moss Studio does not answer'));
}

console.log(failures === 0 ? '\nAll scene pictures checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
