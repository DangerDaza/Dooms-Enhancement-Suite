/**
 * Snowflakes Effect Module
 * Decorative falling-snow overlay, rendered on a dedicated particle canvas
 * (one canvas + one rAF loop instead of 50 CSS-animated DOM nodes). Uses its
 * own engine instance so it can run alongside a weather effect, which owns
 * the shared engine and a different stacking context.
 */
import { extensionSettings } from '../../core/state.js';
import { createParticleEngine } from './particleCanvas.js';

let snowflakesContainer = null;
let snowEngine = null;

/**
 * Create snowflakes canvas overlay
 */
function createSnowflakes() {
    if (snowflakesContainer) return; // Already created
    snowflakesContainer = document.createElement('div');
    snowflakesContainer.className = 'rpg-snowflakes-container';
    document.body.appendChild(snowflakesContainer);
    snowEngine = createParticleEngine();
    snowEngine.mount(snowflakesContainer);
    snowEngine.setEffects({ snow: { count: 50 } });
}

/**
 * Remove snowflakes overlay
 */
function removeSnowflakes() {
    if (snowEngine) {
        snowEngine.destroy();
        snowEngine = null;
    }
    if (snowflakesContainer) {
        snowflakesContainer.remove();
        snowflakesContainer = null;
    }
}

/**
 * Toggle snowflakes effect
 */
export function toggleSnowflakes(enabled) {
    if (enabled) {
        createSnowflakes();
    } else {
        removeSnowflakes();
    }
}

/**
 * Initialize snowflakes based on saved state
 */
export function initSnowflakes() {
    const enabled = extensionSettings.enableSnowflakes || false;
    if (enabled) {
        createSnowflakes();
    }
}

/**
 * Clean up snowflakes
 */
export function cleanupSnowflakes() {
    removeSnowflakes();
}
