/**
 * The version markers move together: manifest.json (what the server reports),
 * whatsnew.json (what the What's New window shows), and CODE_VERSION in
 * src/core/config.js (what the scripts running in a browser say they are,
 * compared with the manifest to catch a cached copy).
 *
 * Run: node tools/version-test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const { CODE_VERSION } = await import(path.join(root, 'src/core/config.js'));

const manifest = read('manifest.json').version;
const whatsNew = read('whatsnew.json').version;
const failures = [];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(manifest)) failures.push(`manifest.json version "${manifest}" is not a version`);
if (whatsNew !== manifest) failures.push(`whatsnew.json says ${whatsNew}, manifest.json says ${manifest}`);
if (CODE_VERSION !== manifest) failures.push(`CODE_VERSION says ${CODE_VERSION}, manifest.json says ${manifest}`);

if (failures.length) {
    for (const f of failures) console.error('FAIL', f);
    process.exit(1);
}
console.log(`version-test: ${manifest} in manifest.json, whatsnew.json and CODE_VERSION`);
