#!/usr/bin/env node
/**
 * Pay-for-what-you-use gate (docs/rebuild-philosophy.md §3): walks the
 * STATIC import graph from index.js and fails if a module that must only
 * load on demand is reachable at startup.
 *
 * tools/load-check.mjs can't catch this — it evaluates every file under
 * src/ regardless of how it's imported.
 *
 * Usage:  node tools/lazy-graph-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = a lazy module is eagerly reachable
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));

/** Modules that must never be in the startup graph. */
const MUST_BE_LAZY = [
    // DES voices: only voiceBoot.js (and pure settings/catalog helpers) load eagerly.
    'src/systems/voices/voiceEngine.js',
    'src/systems/voices/segmenter.js',
    'src/systems/voices/player.js',
    'src/systems/voices/transport.js',
    'src/systems/voices/presence.js',
    'src/systems/voices/voiceResolver.js',
    'src/systems/voices/stAutoReadGuard.js',
    'src/systems/voices/connection.js',
    'src/systems/ui/voicePane.js',
    'src/systems/ui/voicesSettingsUI.js',
];

// Static imports only: `import x from '…'`, `import {…} from '…'`,
// `import '…'`, `export … from '…'`. Dynamic import('…') is excluded.
const staticImportRe = /^\s*(?:import|export)\s+(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const seen = new Map(); // repo-relative path -> parent (for the chain)
const queue = ['index.js'];
seen.set('index.js', null);
while (queue.length) {
    const file = queue.shift();
    const abs = join(repo, file);
    if (!existsSync(abs)) continue;
    const src = stripComments(readFileSync(abs, 'utf8'));
    for (const m of src.matchAll(staticImportRe)) {
        const spec = m[1];
        if (!spec.startsWith('.')) continue;
        const target = relative(repo, normalize(join(dirname(abs), spec)));
        if (target.startsWith('..')) continue; // SillyTavern core
        if (seen.has(target)) continue;
        seen.set(target, file);
        queue.push(target);
    }
}

function chain(file) {
    const out = [];
    for (let f = file; f; f = seen.get(f)) out.unshift(f);
    return out.join(' → ');
}

let failures = 0;
for (const lazy of MUST_BE_LAZY) {
    if (!existsSync(join(repo, lazy))) {
        console.error(`MISSING: ${lazy} (update MUST_BE_LAZY)`);
        failures++;
        continue;
    }
    if (seen.has(lazy)) {
        console.error(`EAGER: ${lazy} is statically reachable:\n  ${chain(lazy)}`);
        failures++;
    }
}
if (failures) process.exit(1);
console.log(`lazy-graph-test: ${MUST_BE_LAZY.length} lazy modules checked, ${seen.size} modules in the startup graph`);
