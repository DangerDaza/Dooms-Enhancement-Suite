#!/usr/bin/env node
/**
 * Image Generation model checks (docs/image-gen-plan.md): the config, the
 * migration from the keys it replaces, the portrait rule, the render values.
 * Usage:  node tools/image-gen-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { IMAGE_SOURCES, SIZE_PRESETS, PORTRAIT_MODES, defaultImageGenConfig, imageGenConfig, migrateImageGenSettings, portraitPlan, portraitStateHash, renderValues, describeSource, sizeById } from '../src/utils/imageGen.js';

let failures = 0;
function check(name, ok, extra = '') {
    console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : extra ? `\n      ${extra}` : ''}`);
    if (!ok) failures++;
}

console.log('\n§1 the config');
{
    const d = imageGenConfig({});
    check('defaults: SillyTavern source, ComfyUI on 8189, no workflow, portraits off, square', d.source === 'sillytavern' && d.comfy.url === 'http://127.0.0.1:8189' && d.comfy.workflow === '' && d.portraits.mode === 'off' && d.portraits.size === 'square' && d.portraits.notify === true);
    const c = imageGenConfig({ imageGen: { v: 1, source: 'comfy', comfy: { url: ' http://10.0.0.5:8189/// ', workflow: ' Moss.json ', steps: '0', cfg: 99, timeoutSec: 5 }, portraits: { mode: 'every_reply', size: 'tall', notify: false } } });
    check('normalised: url trimmed of slashes, workflow trimmed, steps clamps to 1, cfg to 20, timeout to 20, a bad size falls back, notify off', c.source === 'comfy' && c.comfy.url === 'http://10.0.0.5:8189' && c.comfy.workflow === 'Moss.json' && c.comfy.steps === 1 && c.comfy.cfg === 20 && c.comfy.timeoutSec === 20 && c.portraits.mode === 'every_reply' && c.portraits.size === 'square' && c.portraits.notify === false);
    check('an unknown source falls back to SillyTavern; an unknown mode to off', imageGenConfig({ imageGen: { source: 'dalle', portraits: { mode: 'always' } } }).source === 'sillytavern' && imageGenConfig({ imageGen: { portraits: { mode: 'always' } } }).portraits.mode === 'off');
    check('the lists', IMAGE_SOURCES.map(s => s.id).join(',') === 'sillytavern,comfy' && PORTRAIT_MODES.map(m => m.id).join(',') === 'off,only_missing,state_changed,every_reply' && SIZE_PRESETS.length === 3 && sizeById('nope').id === 'portrait');
    const fresh = defaultImageGenConfig(); fresh.comfy.url = 'x';
    check('defaultImageGenConfig gives a fresh copy each time', defaultImageGenConfig().comfy.url === 'http://127.0.0.1:8189');
}

console.log('\n§2 the migration');
{
    const s = { autoGenerateAvatars: true, syncExpressionsToPresentCharacters: false, portraitEnhancementMode: 'expressions', autoPortraitMode: 'only_missing', scenePictures: { enabled: false, comfyUrl: 'http://127.0.0.1:8189', workflow: '' } };
    const r = migrateImageGenSettings(s);
    check('Auto Avatars on → portraits only missing; scene pictures off → SillyTavern source', r.changed && s.imageGen.portraits.mode === 'only_missing' && s.imageGen.source === 'sillytavern' && s.imageGen.v === 1, JSON.stringify(r));
    check('…and it runs once: a second call changes nothing', migrateImageGenSettings(s).changed === false);
    check('…and the old keys stay until their readers are gone', s.autoGenerateAvatars === true && s.portraitEnhancementMode === 'expressions');
    const t = { autoGenerateAvatars: true, syncExpressionsToPresentCharacters: true, portraitEnhancementMode: 'autoPortraits', autoPortraitMode: 'state_changed', scenePictures: { enabled: true, comfyUrl: 'http://10.0.0.5:8189/', workflow: 'DES Scene Moss.json', steps: 30, cfg: 3, sampler: 'euler', scheduler: 'karras', model: 'moss.safetensors', timeoutSec: 240 } };
    migrateImageGenSettings(t);
    check('Per-Character Expressions with auto portraits → that mode wins over Auto Avatars', t.imageGen.portraits.mode === 'state_changed');
    check('scene pictures on with a workflow → ComfyUI source with the connection carried over', t.imageGen.source === 'comfy' && t.imageGen.comfy.url === 'http://10.0.0.5:8189/' && imageGenConfig(t).comfy.url === 'http://10.0.0.5:8189' && t.imageGen.comfy.workflow === 'DES Scene Moss.json' && t.imageGen.comfy.steps === 30 && t.imageGen.comfy.sampler === 'euler' && t.imageGen.comfy.model === 'moss.safetensors' && t.imageGen.comfy.timeoutSec === 240);
    const u = { syncExpressionsToPresentCharacters: true, portraitEnhancementMode: 'expressions', autoPortraitMode: 'every_reply' };
    migrateImageGenSettings(u);
    check('expression sprites with a leftover auto mode → portraits off (sprites are not pictures)', u.imageGen.portraits.mode === 'off');
    const v = { imageGen: { v: 1, source: 'comfy' }, autoGenerateAvatars: true };
    check('a settings file already on the new shape is left alone', migrateImageGenSettings(v).changed === false && v.imageGen.source === 'comfy');
    check('nothing to migrate from is still a valid config', migrateImageGenSettings({}).changed === true && imageGenConfig({}).portraits.mode === 'off');
}

console.log('\n§3 the portrait rule');
{
    const cfg = (mode) => imageGenConfig({ imageGen: { portraits: { mode } } });
    const entries = ['Mara', { name: 'Tomas', details: { appearance: 'grey coat' } }, 'unavailable', 'Mara'];
    const store = { Mara: '/user/images/des-portraits/mara.png' };
    const made = { Mara: portraitStateHash('Mara') };
    const facts = { existing: (n) => store[n] || '', generatedHash: (n) => made[n] || null, pending: () => false, cardAvatar: () => false };
    check('off: nobody', portraitPlan(cfg('off'), entries, facts).names.length === 0 && portraitPlan(cfg('off'), entries, facts).reason === 'off');
    check('only missing: the one with no portrait, once, never "unavailable"', portraitPlan(cfg('only_missing'), entries, facts).names.join(',') === 'Tomas');
    check('state changed: a DES-made portrait whose look has not changed stays; a changed look is due', portraitPlan(cfg('state_changed'), entries, facts).names.join(',') === 'Tomas' && portraitPlan(cfg('state_changed'), [{ name: 'Mara', details: { appearance: 'now in red' } }], facts).names.join(',') === 'Mara');
    check('every reply: everyone DES may draw', portraitPlan(cfg('every_reply'), entries, facts).names.join(',') === 'Mara,Tomas');
    const own = { existing: () => '/user/images/upload.png', generatedHash: () => null, pending: () => false, cardAvatar: () => false };
    check("the user's own portrait is never replaced, whatever the mode", portraitPlan(cfg('every_reply'), ['Mara'], own).names.length === 0);
    const card = { existing: () => '', generatedHash: () => null, pending: () => false, cardAvatar: (n) => n === 'Tomas' };
    check('a SillyTavern card with a face needs no portrait; the rest still do', portraitPlan(cfg('only_missing'), ['Tomas', 'Ilse'], card).names.join(',') === 'Ilse');
    check('one being made is not asked for again', portraitPlan(cfg('only_missing'), ['Ilse'], { ...card, pending: (n) => n === 'Ilse' }).names.length === 0);
    check('never from a recovery, never from a chat load', portraitPlan(cfg('every_reply'), entries, facts, { recovery: true }).reason === 'recovery' && portraitPlan(cfg('every_reply'), entries, facts, { fresh: false }).reason === 'not fresh');
    check('the plan carries the hash the portrait is made from', portraitPlan(cfg('only_missing'), entries, facts).hashes.Tomas === portraitStateHash({ name: 'Tomas', details: { appearance: 'grey coat' } }));
    check('the hash reads the look, not the order of keys, and is case-blind', portraitStateHash({ name: 'A', appearance: 'Red Cloak' }) === portraitStateHash({ appearance: 'red cloak', name: 'a' }) && portraitStateHash({ name: 'A', appearance: 'red' }) !== portraitStateHash({ name: 'A', appearance: 'blue' }));
}

console.log('\n§4 the render values and the status line');
{
    const comfy = imageGenConfig({ imageGen: { comfy: { steps: 20, cfg: 4, sampler: 'euler', scheduler: 'normal', model: 'm.safetensors' } } }).comfy;
    const v = renderValues({ prompt: '  a portrait  ', negative: 'blurry', size: 'portrait', comfy, seed: 7 });
    check('the values a workflow is filled with', v.prompt === 'a portrait' && v.negative_prompt === 'blurry' && v.width === 864 && v.height === 1536 && v.steps === 20 && v.scale === 4 && v.sampler === 'euler' && v.scheduler === 'normal' && v.seed === 7 && v.model === 'm.safetensors' && v.clip === undefined && typeof v.user_avatar === 'string');
    check('a random seed when none is given; a square by default', renderValues({ prompt: 'x', comfy }).seed >= 0 && renderValues({ prompt: 'x', comfy }).width === 1024);
    const st = imageGenConfig({});
    check('status: SillyTavern not enabled says where to switch it on', describeSource(st, { stAvailable: false }).includes('Extensions → Image Generation'));
    check('status: SillyTavern enabled names its source', describeSource(st, { stAvailable: true, stSourceName: 'ComfyUI' }).includes('(ComfyUI)'));
    const cf = imageGenConfig({ imageGen: { source: 'comfy', comfy: { workflow: 'Moss.json' } } });
    check('status: ComfyUI names the address and the workflow', describeSource(cf).includes('8189') && describeSource(cf).includes('Moss.json') && describeSource(imageGenConfig({ imageGen: { source: 'comfy' } })).includes('no workflow'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll image generation checks pass');
process.exit(failures ? 1 : 0);
