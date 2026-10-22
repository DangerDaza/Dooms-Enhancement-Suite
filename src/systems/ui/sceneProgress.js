/**
 * Scene pictures — the bar at the foot of the chat while a picture is made
 * (docs/scene-pictures-plan.md §3). It follows the run's progress
 * (scenePictures.js: waiting, the caption, ComfyUI's queue, the step count
 * while it renders, saving) and leaves once the picture has landed, a
 * little later when the run failed. A DOM element only, never a message:
 * nothing of it is saved with the chat.
 */
import { getSceneProgress, SCENE_CHANGED_EVENT } from '../features/scenePictures.js';
import { progressLabel } from '../../utils/scenePictures.js';

const ID = 'dooms-scene-progress';
let tick = null;
let hideTimer = null;

function stopTick() { if (tick) { clearInterval(tick); tick = null; } }
function startTick() { if (!tick) tick = setInterval(render, 1000); }

function render() {
    const p = getSceneProgress();
    const active = p.stage && p.stage !== 'idle';
    const $chat = $('#chat');
    let $el = $(`#${ID}`);
    if (!active || !$chat.length) { $el.remove(); stopTick(); return; }
    if (!$el.length) {
        $el = $(`<div id="${ID}" class="dooms-scene-progress" role="status" aria-live="polite"><span class="dooms-scene-progress-label"></span><div class="dooms-scene-progress-bar"><div class="dooms-scene-progress-fill"></div></div></div>`);
        $chat.append($el);
    } else if ($el.next().length) {
        $chat.append($el);    // a message landed after it: back to the foot
    }
    const { text, percent } = progressLabel({ ...p, now: Date.now() });
    $el.find('.dooms-scene-progress-label').text(text);
    $el.toggleClass('is-indeterminate', percent === null && p.stage !== 'failed')
        .toggleClass('is-failed', p.stage === 'failed')
        .toggleClass('is-done', p.stage === 'done');
    $el.find('.dooms-scene-progress-fill').css('width', percent === null ? '' : `${percent}%`);
    if (p.stage === 'done' || p.stage === 'failed') {
        stopTick();
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => $(`#${ID}`).remove(), p.stage === 'done' ? 1500 : 8000);
    } else {
        clearTimeout(hideTimer);
        startTick();
    }
}

/** Listens for the run's changes; the bar draws itself from them. */
export function initSceneProgress() {
    try { window.addEventListener(SCENE_CHANGED_EVENT, () => { try { render(); } catch (e) { /* the bar is a nicety */ } }); } catch (e) { /* no window */ }
}
