#!/usr/bin/env node
/**
 * Load-check: actually links and evaluates DES's ENTIRE ES-module graph in
 * Node with stubbed SillyTavern internals and browser globals.
 *
 * This is the ONLY reliable pre-ship syntax/link gate. `node --check` does
 * not parse the module goal correctly and has passed files with top-level
 * syntax errors that killed the extension in the browser (see commit
 * 65f5ba4 — "extension disappeared" after update).
 *
 * Usage:  node tools/load-check.mjs        (from the repo root)
 * Exit:   0 = whole graph loads, 1 = failure (error printed)
 *
 * The sandbox is per process: $TMPDIR/des-load-check-<pid>, wiped before
 * the build and removed on exit, so two runs never collide. SillyTavern's
 * public/ is the `public` folder inside it, the repo copied to
 * public/scripts/extensions/third-party/DES, so an import that climbs one
 * level above public/ (src/utils/responseExtractor.js does) still lands
 * inside this process's directory. Set DES_SANDBOX=/some/dir to build
 * there instead and keep the directory afterwards (the sandbox tests do,
 * through tools/sandbox.mjs). The root used is printed as "SANDBOX: ...".
 *
 * Run this before EVERY push that touches JS.
 */
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { globSync } from 'node:fs';
import { resolveSandbox, removeOnExit } from './sandbox.mjs';

const repo = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const { sandbox, root, owned } = resolveSandbox();
const repoAt = join(root, 'scripts/extensions/third-party/DES');
if (owned) removeOnExit(sandbox);

rmSync(sandbox, { recursive: true, force: true });
mkdirSync(dirname(repoAt), { recursive: true });
cpSync(repo, repoAt, {
    recursive: true,
    filter: (src) => !/\/(\.git|docs|styles|tools)(\/|$)|\.(png|html|css|md)$/.test(src),
});
console.log(`SANDBOX: ${root}${owned ? ' (removed on exit; set DES_SANDBOX to keep one)' : ''}`);

// Collect external (SillyTavern-core) imports and the names pulled from them
const importRe = /import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+[\w$]+|([\w$]+))?\s*from\s*['"]([^'"]+)['"]/gs;
const files = ['index.js', ...globSync('src/**/*.js', { cwd: repo })];
const stubs = new Map(); // absolute stub path -> Set of names

for (const f of files) {
    const src = readFileSync(join(repo, f), 'utf8');
    const fileDir = dirname(join(repoAt, f));
    for (const m of src.matchAll(importRe)) {
        const [, def, named, bare, spec] = m;
        if (!spec.startsWith('.')) continue;
        const target = normalize(join(fileDir, spec));
        if (target.startsWith(repoAt)) continue;
        if (!target.startsWith(sandbox + sep)) {
            console.error(`IMPORT ESCAPES THE SANDBOX: ${f} imports '${spec}', which resolves above ${sandbox}.`);
            console.error('A SillyTavern-core import may climb to public/ or one level above it, no further.');
            process.exit(1);
        }
        if (!stubs.has(target)) stubs.set(target, new Set());
        if (def) stubs.get(target).add('__default__');
        if (named) {
            const clean = named.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
            for (const part of clean.split(',')) {
                const name = part.trim().split(/\s+as\s+/)[0].trim();
                if (/^[A-Za-z_$][\w$]*$/.test(name)) stubs.get(target).add(name);
            }
        }
    }
}
for (const [path, names] of stubs) {
    mkdirSync(dirname(path), { recursive: true });
    const lines = ['const anything = globalThis.__DES_ANYTHING__;'];
    for (const n of names) {
        lines.push(n === '__default__' ? 'export default anything;' : `export const ${n} = anything;`);
    }
    writeFileSync(path, lines.join('\n') + '\n');
}

// Browser-ish globals touched at module-evaluation time
const anything = new Proxy(function () {}, {
    get(t, p) {
        if (p === Symbol.toPrimitive) return () => 'stub';
        if (p === 'then') return undefined;
        if (p === Symbol.iterator) return function* () {};
        return anything;
    },
    apply() { return anything; },
    construct() { return {}; },
});
globalThis.__DES_ANYTHING__ = anything;
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = anything;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: 8, maxTouchPoints: 0 }, configurable: true,
});
globalThis.jQuery = anything;
globalThis.$ = anything;
globalThis.toastr = anything;
globalThis.SillyTavern = anything;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

// Release invariant: whatsnew.json must target the manifest version,
// otherwise the What's New screen silently never shows for the release
// (the gate keys on manifest version vs last-seen version).
{
    const manifest = JSON.parse(readFileSync(join(repo, 'manifest.json'), 'utf8'));
    const notes = JSON.parse(readFileSync(join(repo, 'whatsnew.json'), 'utf8'));
    if (manifest.version !== notes.version) {
        console.error(`VERSION DRIFT: manifest.json is ${manifest.version} but whatsnew.json targets ${notes.version}.`);
        console.error('Bump both together — the What\'s New screen keys on the manifest version.');
        process.exit(1);
    }
}

try {
    await import(pathToFileURL(join(repoAt, 'index.js')).href);
    // index.js only statically reaches part of the tree — dynamic-only
    // modules (deferred UI, whatsNew, lorebook cluster, ...) must be
    // imported individually or their errors ship unseen.
    for (const f of files) {
        await import(pathToFileURL(join(repoAt, f)).href);
    }
    console.log(`LOAD OK — entire module graph linked and evaluated (${files.length} modules)`);
    process.exit(0);
} catch (e) {
    console.error('LOAD FAILED:', e?.message);
    if (e?.stack) console.error(e.stack.split('\n').slice(0, 8).join('\n'));
    process.exit(1);
}
