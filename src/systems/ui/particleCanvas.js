/**
 * Canvas Particle Engine
 *
 * Replaces the DOM-based weather particles (up to ~100 individually
 * CSS-animated divs, each its own compositor layer) with ONE canvas and ONE
 * requestAnimationFrame loop. Visuals replicate the original CSS keyframes
 * (rpg-snowfall, rpg-rainfall, rpg-mistFloat, rpg-windBlow, twinkle,
 * firefly-float, dust-float, orb-drift).
 *
 * The loop fully stops — not merely skips frames — whenever:
 *   - the tab is hidden (visibilitychange),
 *   - prefers-reduced-motion is set,
 *   - performance mode is active (body.dooms-perf-mode),
 *   - there are no active effects.
 *
 * Effect counts are capped on small screens / low-core devices.
 *
 * Usage:
 *   const engine = getParticleEngine();
 *   engine.mount(containerEl);             // canvas parented for z-index/stacking
 *   engine.setEffects({ snow: { count: 50 }, wind: { count: 30 } });
 *   engine.setEffects(null);               // clear + stop
 *   engine.destroy();                      // full teardown
 */

let _instance = null;

/** Device-aware particle budget multiplier. */
function deviceScale() {
    const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 700;
    const lowCore = (navigator.hardwareConcurrency || 4) <= 4;
    if (smallScreen && lowCore) return 0.3;
    if (smallScreen || lowCore) return 0.5;
    return 1;
}

const TAU = Math.PI * 2;
const rand = (min, max) => min + Math.random() * (max - min);

// ── Per-effect particle factories & renderers ────────────────────────────
// Each effect type defines: spawn(w, h) -> particle, step(p, dt, w, h),
// draw(ctx, p). Particles recycle themselves in step() by re-spawning above
// the viewport / at the start of their path.

const EFFECTS = {
    snow: {
        defaultCount: 50,
        spawn(w, h, initial) {
            return {
                x: rand(0, w),
                y: initial ? rand(-h, h) : rand(-40, -10),
                size: rand(8, 19),                  // font-size 0.6em–1.2em
                speed: h / rand(10, 20),            // 10–20s to cross viewport
                drift: rand(-12, 12),
                spin: rand(0.3, 1) * (Math.random() < 0.5 ? -1 : 1),
                angle: rand(0, TAU),
                opacity: rand(0.5, 0.85),
            };
        },
        step(p, dt, w, h) {
            p.y += p.speed * dt;
            p.x += p.drift * dt;
            p.angle += p.spin * dt;
            if (p.y > h + 20) Object.assign(p, this.spawn(w, h, false));
        },
        draw(ctx, p) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.globalAlpha = p.opacity;
            ctx.fillStyle = 'white';
            ctx.shadowColor = 'rgba(255,255,255,0.8)';
            ctx.shadowBlur = 5;
            ctx.font = `${p.size}px Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('❄', 0, 0);
            ctx.restore();
        },
    },

    rain: {
        defaultCount: 100,
        spawn(w, h, initial) {
            const len = rand(40, 60);
            return {
                x: rand(0, w),
                y: initial ? rand(-h, h) : rand(-80, -40),
                len,
                speed: h / rand(0.5, 1.0),          // 0.5–1s to cross viewport
                opacity: rand(0.5, 0.8),
            };
        },
        step(p, dt, w, h) {
            p.y += p.speed * dt;
            if (p.y > h + 20) Object.assign(p, this.spawn(w, h, false));
        },
        draw(ctx, p) {
            const grad = ctx.createLinearGradient(p.x, p.y - p.len, p.x, p.y);
            grad.addColorStop(0, 'rgba(174,194,224,0)');
            grad.addColorStop(1, `rgba(174,194,224,${p.opacity})`);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y - p.len);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        },
    },

    mist: {
        defaultCount: 5,
        spawn(w, h, initial, index = 0) {
            return {
                cy: h * (0.15 + index * 0.18),
                ry: h * 0.2,
                rx: w * 0.6,
                phase: rand(0, TAU),
                period: rand(15, 25),
                baseOpacity: rand(0.1, 0.3),
                t: 0,
            };
        },
        step(p, dt) {
            p.t += dt;
        },
        draw(ctx, p, w) {
            const cycle = Math.sin((p.t / p.period) * TAU + p.phase);
            const cx = w / 2 + cycle * w * 0.1;
            const opacity = p.baseOpacity * (0.6 + 0.4 * cycle);
            const grad = ctx.createRadialGradient(cx, p.cy, 0, cx, p.cy, p.rx);
            grad.addColorStop(0, `rgba(200,200,220,${opacity})`);
            grad.addColorStop(0.7, 'rgba(200,200,220,0)');
            ctx.save();
            ctx.translate(cx, p.cy);
            ctx.scale(1, p.ry / p.rx);
            ctx.translate(-cx, -p.cy);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(cx, p.cy, p.rx, 0, TAU);
            ctx.fill();
            ctx.restore();
        },
    },

    wind: {
        defaultCount: 30,
        spawn(w, h, initial) {
            return {
                x: initial ? rand(-100, w) : rand(-180, -80),
                y: rand(0, h),
                len: rand(60, 100),
                speed: (w + 200) / rand(1.5, 2.5),
                opacity: rand(0.4, 0.7),
            };
        },
        step(p, dt, w, h) {
            p.x += p.speed * dt;
            if (p.x > w + 120) Object.assign(p, this.spawn(w, h, false));
        },
        draw(ctx, p) {
            const grad = ctx.createLinearGradient(p.x, p.y, p.x + p.len, p.y);
            grad.addColorStop(0, 'rgba(200,200,220,0)');
            grad.addColorStop(0.5, `rgba(200,200,220,${p.opacity})`);
            grad.addColorStop(1, 'rgba(200,200,220,0)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            // skewX(-20deg): slight vertical rise along the streak
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + p.len, p.y - p.len * 0.36);
            ctx.stroke();
        },
    },

    stars: {
        defaultCount: 60,
        spawn(w, h) {
            return {
                x: rand(0, w),
                y: rand(0, h * 0.6),                 // stars in upper portion
                size: rand(1, 3),
                phase: rand(0, TAU),
                period: rand(2, 5),
                bright: Math.random() < 0.12,        // ~1 in 8 is a bright star
                t: 0,
            };
        },
        step(p, dt) { p.t += dt; },
        draw(ctx, p) {
            const twinkle = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin((p.t / p.period) * TAU + p.phase));
            const r = p.size * (1 + 0.3 * twinkle) * (p.bright ? 1.8 : 1);
            const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2);
            grad.addColorStop(0, `rgba(255,255,255,${twinkle})`);
            grad.addColorStop(0.4, `rgba(200,220,255,${twinkle * 0.8})`);
            grad.addColorStop(0.7, 'rgba(200,220,255,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r * 2, 0, TAU);
            ctx.fill();
        },
    },

    fireflies: {
        defaultCount: 15,
        spawn(w, h) {
            return {
                ox: rand(0, w),
                oy: h * rand(0.4, 0.95),
                phase: rand(0, 1),
                period: rand(8, 15),
                t: 0,
            };
        },
        step(p, dt, w, h) {
            p.t += dt;
            if (p.t / p.period + p.phase >= 1 + p.phase) {  // cycle complete
                Object.assign(p, this.spawn(w, h), { t: 0 });
            }
        },
        draw(ctx, p) {
            // Replicates the wandering rise of rpg-night-firefly-float
            const prog = ((p.t / p.period) + p.phase) % 1;
            const x = p.ox + Math.sin(prog * TAU * 2.5) * 12;
            const y = p.oy - prog * 80;
            const opacity = Math.sin(prog * Math.PI) * (0.55 + 0.45 * Math.sin(prog * TAU * 3));
            if (opacity <= 0) return;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, 8);
            grad.addColorStop(0, `rgba(200,255,150,${opacity})`);
            grad.addColorStop(0.3, `rgba(180,255,120,${opacity * 0.8})`);
            grad.addColorStop(0.6, `rgba(150,230,100,${opacity * 0.4})`);
            grad.addColorStop(1, 'rgba(150,230,100,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, TAU);
            ctx.fill();
        },
    },

    dustMotes: {
        defaultCount: 25,
        spawn(w, h) {
            return {
                ox: rand(0, w),
                oy: rand(0, h),
                size: rand(2, 6),
                phase: rand(0, 1),
                period: rand(12, 20),
                t: 0,
            };
        },
        step(p, dt, w, h) {
            p.t += dt;
            if (p.t >= p.period) Object.assign(p, this.spawn(w, h), { t: 0 });
        },
        draw(ctx, p) {
            // rpg-clear-dust-float: drift +60px/-100px over the cycle, fade in/out
            const prog = ((p.t / p.period) + p.phase) % 1;
            const x = p.ox + prog * 60;
            const y = p.oy - prog * 100;
            const opacity = Math.min(1, Math.sin(prog * Math.PI) * 1.4) * 0.8;
            if (opacity <= 0) return;
            const r = p.size * (1 + 0.2 * Math.sin(prog * Math.PI));
            const grad = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r);
            grad.addColorStop(0, `rgba(255,250,220,${opacity * 0.9})`);
            grad.addColorStop(0.5, `rgba(255,235,180,${opacity * 0.6})`);
            grad.addColorStop(1, 'rgba(255,220,150,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, TAU);
            ctx.fill();
        },
    },

    lightOrbs: {
        defaultCount: 6,
        spawn(w, h) {
            return {
                ox: rand(w * 0.1, w * 0.9),
                oy: rand(h * 0.1, h * 0.9),
                r: rand(80, 200) / 2,
                phase: rand(0, TAU),
                period: rand(20, 30),
                t: 0,
            };
        },
        step(p, dt) { p.t += dt; },
        draw(ctx, p) {
            const a = (p.t / p.period) * TAU + p.phase;
            const x = p.ox + Math.cos(a) * 22;
            const y = p.oy + Math.sin(a * 0.7) * 18;
            const opacity = 0.4 + 0.3 * (0.5 + 0.5 * Math.sin(a));
            const grad = ctx.createRadialGradient(x, y, 0, x, y, p.r);
            grad.addColorStop(0, `rgba(255,250,230,${0.12 * opacity})`);
            grad.addColorStop(0.4, `rgba(255,245,200,${0.06 * opacity})`);
            grad.addColorStop(0.7, 'rgba(255,245,200,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, p.r, 0, TAU);
            ctx.fill();
        },
    },
};

class ParticleEngine {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'dooms-particle-canvas';
        // Stacking (z-index) comes from the mount container; the canvas just
        // fills the viewport and never intercepts input.
        Object.assign(this.canvas.style, {
            position: 'fixed',
            inset: '0',
            width: '100vw',
            height: '100dvh',
            pointerEvents: 'none',
        });
        this.ctx = this.canvas.getContext('2d');
        this.pools = new Map();      // effectName -> particle array
        this.active = {};            // effectName -> config
        this.raf = null;
        this.lastTs = 0;
        this._onVisibility = () => this._sync();
        this._onResize = () => this._resize();
        this._reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        this._onMotionPref = () => this._sync();
        document.addEventListener('visibilitychange', this._onVisibility);
        window.addEventListener('resize', this._onResize);
        if (this._reducedMotion.addEventListener) {
            this._reducedMotion.addEventListener('change', this._onMotionPref);
        }
        this._resize();
    }

    /** Parent the canvas into a container (controls stacking context). */
    mount(container) {
        if (this.canvas.parentElement !== container) {
            container.appendChild(this.canvas);
        }
        this._sync();
    }

    _resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = Math.round(this.width * dpr);
        this.canvas.height = Math.round(this.height * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Mist particles are sized from viewport dims — rebuild them on resize
        if (this.pools.has('mist')) this.pools.delete('mist');
        this._buildPools();
    }

    /**
     * Set the active effects. Pass null/{} to clear.
     * @param {Object|null} effects - e.g. { snow: {count: 50}, wind: {} }
     */
    setEffects(effects) {
        this.active = effects || {};
        // Drop pools for effects no longer active; build new ones
        for (const name of [...this.pools.keys()]) {
            if (!this.active[name]) this.pools.delete(name);
        }
        this._buildPools();
        this._sync();
    }

    _buildPools() {
        const scale = deviceScale();
        for (const [name, cfg] of Object.entries(this.active)) {
            const effect = EFFECTS[name];
            if (!effect) continue;
            const count = Math.max(1, Math.round((cfg?.count ?? effect.defaultCount) * scale));
            let pool = this.pools.get(name);
            if (!pool || pool.length !== count) {
                pool = [];
                for (let i = 0; i < count; i++) {
                    pool.push(effect.spawn(this.width, this.height, true, i));
                }
                this.pools.set(name, pool);
            }
        }
    }

    _shouldRun() {
        return Object.keys(this.active).length > 0 &&
            !document.hidden &&
            !this._reducedMotion.matches &&
            !document.body.classList.contains('dooms-perf-mode') &&
            this.canvas.isConnected;
    }

    /** Start or fully stop the loop based on current conditions. */
    _sync() {
        if (this._shouldRun()) {
            if (this.raf === null) {
                this.lastTs = 0;
                this.raf = requestAnimationFrame((ts) => this._tick(ts));
            }
        } else if (this.raf !== null) {
            cancelAnimationFrame(this.raf);
            this.raf = null;
            this.ctx.clearRect(0, 0, this.width, this.height);
        }
    }

    _tick(ts) {
        this.raf = null;
        if (!this._shouldRun()) {
            this.ctx.clearRect(0, 0, this.width, this.height);
            return;
        }
        const dt = this.lastTs ? Math.min((ts - this.lastTs) / 1000, 0.1) : 0.016;
        this.lastTs = ts;

        const { ctx, width: w, height: h } = this;
        ctx.clearRect(0, 0, w, h);
        for (const [name, pool] of this.pools) {
            const effect = EFFECTS[name];
            for (const p of pool) {
                effect.step(p, dt, w, h);
                effect.draw(ctx, p, w, h);
            }
        }
        this.raf = requestAnimationFrame((t) => this._tick(t));
    }

    /** Stop the loop and remove the canvas + listeners. */
    destroy() {
        this.setEffects(null);
        document.removeEventListener('visibilitychange', this._onVisibility);
        window.removeEventListener('resize', this._onResize);
        if (this._reducedMotion.removeEventListener) {
            this._reducedMotion.removeEventListener('change', this._onMotionPref);
        }
        this.canvas.remove();
        if (_instance === this) _instance = null;
    }
}

/** Singleton accessor (used by the weather system). */
export function getParticleEngine() {
    if (!_instance) _instance = new ParticleEngine();
    return _instance;
}

/** Tear down the singleton if it exists (feature disable). */
export function destroyParticleEngine() {
    if (_instance) _instance.destroy();
}

/**
 * Independent engine instance for features that need their own stacking
 * context (e.g. the decorative snowflakes overlay, which can be active at the
 * same time as a weather effect).
 */
export function createParticleEngine() {
    return new ParticleEngine();
}
