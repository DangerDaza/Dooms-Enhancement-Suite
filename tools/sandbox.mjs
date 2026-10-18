/**
 * The DES test sandbox: where it lives for this process, and how a test
 * gets one built.
 *
 * tools/load-check.mjs builds a SillyTavern-shaped tree — `public/` with the
 * core modules stubbed and the repo copied to
 * public/scripts/extensions/third-party/DES — and the sandbox tests import
 * from it. The directory is per process, so two runs never share one (two
 * terminals, a CI matrix, an agent running one test while the gate runs):
 *
 *   DES_SANDBOX=/some/dir   the caller picks the directory; it stays
 *                           afterwards, for a look inside
 *   (unset)                 $TMPDIR/des-load-check-<pid>, removed when the
 *                           process that picked it exits
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SANDBOX_ENV = 'DES_SANDBOX';

/**
 * This process's sandbox: the directory (`sandbox`), SillyTavern's public
 * root inside it (`root`), and whether this process picked it (`owned`).
 */
export function resolveSandbox() {
    const named = process.env[SANDBOX_ENV];
    const sandbox = named ? resolve(named) : join(tmpdir(), `des-load-check-${process.pid}`);
    return { sandbox, root: join(sandbox, 'public'), owned: !named };
}

/** Remove the sandbox when this process exits (for a directory it picked itself). */
export function removeOnExit(sandbox) {
    process.on('exit', () => rmSync(sandbox, { recursive: true, force: true }));
}

/**
 * For the sandbox tests: build this process's sandbox with
 * tools/load-check.mjs and return SillyTavern's public root (SANDBOX) and
 * the DES folder inside it (DES). A failed build prints load-check's own
 * output and exits 1.
 */
export function buildSandbox() {
    const { sandbox, root, owned } = resolveSandbox();
    if (owned) removeOnExit(sandbox);
    const loadCheck = fileURLToPath(new URL('./load-check.mjs', import.meta.url));
    try {
        execFileSync(process.execPath, [loadCheck], {
            stdio: 'pipe',
            encoding: 'utf8',
            env: { ...process.env, [SANDBOX_ENV]: sandbox },
        });
    } catch (e) {
        console.error('FAIL: tools/load-check.mjs could not build the sandbox.');
        const out = `${e?.stdout || ''}${e?.stderr || ''}`.trim();
        console.error(out || e?.message || e);
        process.exit(1);
    }
    return { SANDBOX: root, DES: join(root, 'scripts/extensions/third-party/DES') };
}
