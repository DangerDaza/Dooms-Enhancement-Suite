/**
 * Weather Effects Feature Wrapper
 * Wraps weatherEffects.js with performance optimizations:
 *   - Pause animation when page is hidden
 *   - Only run effects when enabled AND page is visible
 *   - Cache current weather state; skip update if nothing changed
 *   - Single RAF loop for coordinated updates
 */
import { onPageVisible, onPageHidden, isPageVisible } from '../../utils/visibility.js';
import { shallowEqual } from '../../core/diffEngine.js';

import {
    initWeatherEffects as _initWeatherEffects,
    updateWeatherEffect as _updateWeatherEffect,
    toggleDynamicWeather as _toggleDynamicWeather,
    cleanupWeatherEffects as _cleanupWeatherEffects,
    WEATHER_PATTERNS_BY_LANGUAGE,
    getWeatherKeywordsForPrompt,
    getWeatherKeywordsAsPromptString,
} from '../../systems/ui/weatherEffects.js';

// Re-export data helpers unchanged
export {
    WEATHER_PATTERNS_BY_LANGUAGE,
    getWeatherKeywordsForPrompt,
    getWeatherKeywordsAsPromptString,
};

// --- Visibility-aware state ---
let _weatherPaused = false;
let _pendingUpdate = false;
let _lastWeatherState = null;
let _rafId = null;

import {
    extensionSettings,
    lastGeneratedData,
    committedTrackerData,
} from '../../core/state.js';

/**
 * Build a cache key from the weather data inputs so we can skip
 * redundant update calls when nothing has changed.
 */
function captureWeatherState() {
    try {
        const infoBox = lastGeneratedData.infoBox || committedTrackerData.infoBox || '';
        const enabled = !!extensionSettings.enableDynamicWeather;
        const fg = !!extensionSettings.weatherForeground;
        const bg = !!extensionSettings.weatherBackground;
        return { infoBox: typeof infoBox === 'string' ? infoBox : JSON.stringify(infoBox), enabled, fg, bg };
    } catch {
        return null;
    }
}

function weatherStateChanged() {
    const current = captureWeatherState();
    if (current === null) return true;
    if (_lastWeatherState === null) return true;
    return !shallowEqual(current, _lastWeatherState);
}

// --- Page visibility hooks ---
function _onHidden() {
    _weatherPaused = true;
    // Let CSS animations auto-pause via visibility:hidden on the container;
    // the system module manages its own DOM, so we just gate future updates.
}

function _onVisible() {
    _weatherPaused = false;
    if (_pendingUpdate) {
        _pendingUpdate = false;
        updateWeatherEffect();
    }
}

let _listenersRegistered = false;
function _ensureListeners() {
    if (_listenersRegistered) return;
    _listenersRegistered = true;
    onPageHidden(_onHidden);
    onPageVisible(_onVisible);
}

// --- Exports ---

export function initWeatherEffects() {
    _ensureListeners();
    _initWeatherEffects();
    _lastWeatherState = captureWeatherState();
}

export function updateWeatherEffect(weatherData) {
    _ensureListeners();

    // If page is hidden, defer update
    if (_weatherPaused || (typeof isPageVisible === 'function' && !isPageVisible())) {
        _pendingUpdate = true;
        return;
    }

    // Skip if weather state hasn't changed
    if (!weatherStateChanged()) return;

    // Coordinate via a single RAF to avoid layout thrashing
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = requestAnimationFrame(() => {
        _rafId = null;
        _updateWeatherEffect(weatherData);
        _lastWeatherState = captureWeatherState();
    });
}

export function toggleDynamicWeather(enabled) {
    _toggleDynamicWeather(enabled);
    _lastWeatherState = captureWeatherState();
}

export function cleanupWeatherEffects() {
    _lastWeatherState = null;
    _pendingUpdate = false;
    if (_rafId) {
        cancelAnimationFrame(_rafId);
        _rafId = null;
    }
    _cleanupWeatherEffects();
}
