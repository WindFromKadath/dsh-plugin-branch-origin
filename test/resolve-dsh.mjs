/**
 * Dev-only ESM resolve hook: map the specifiers this checkout does not install
 * locally onto the installed DSH packages, so the plugin module and its tests
 * can run straight from this checkout without a local install.
 *
 * This plugin itself imports **nothing**, so the hook is only needed by the
 * real-machine harness in `.verify/`, which boots the actual DSH runtime.
 *
 * The anchor is a DSH profile directory, resolved lazily at first use so the
 * harness can point `DSH_PROFILE_DIR` at the right profile after this module
 * has already been loaded by `--import`:
 *
 *   1. `DSH_PROFILE_DIR` (explicit)
 *   2. `<DSH_HOME>/profiles/desktop`
 *   3. `%USERPROFILE%/.dsh/profiles/desktop`
 *
 * Nothing here is required at runtime inside DSH: there the loader's own
 * runtime resolution finds the same packages.
 *
 * @module test/resolve-dsh
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/** Bare specifiers resolved through the installed DSH packages. */
const VIA_PROFILE = [/^@deepseek-ai\//]

let requireFromProfile

/** Resolve — and cache — a `require` anchored at the DSH profile. */
function profileRequire() {
  if (requireFromProfile !== undefined) return requireFromProfile
  const profileDir = process.env.DSH_PROFILE_DIR
    ?? `${process.env.DSH_HOME ?? `${process.env.USERPROFILE ?? ''}\\.dsh`}\\profiles\\desktop`
  const anchor = profileDir.endsWith('package.json') ? profileDir : `${profileDir}\\package.json`
  requireFromProfile = createRequire(pathToFileURL(anchor))
  return requireFromProfile
}

/**
 * Resolve the listed specifiers from the installed DSH packages and delegate
 * every other specifier to the default resolver.
 * @param specifier - the requested specifier.
 * @param context - the resolver context.
 * @param nextResolve - the default resolver.
 * @returns the resolved module record.
 */
export async function resolve(specifier, context, nextResolve) {
  if (VIA_PROFILE.some((pattern) => pattern.test(specifier))) {
    try {
      return { url: pathToFileURL(profileRequire().resolve(specifier)).href, shortCircuit: true }
    } catch {
      // Fall through to the default resolver so the normal error surfaces.
    }
  }
  return nextResolve(specifier, context)
}
