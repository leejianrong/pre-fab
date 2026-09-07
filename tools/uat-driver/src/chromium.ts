import { existsSync } from "node:fs";
import { chromium, type Browser } from "@playwright/test";

/**
 * Same convention as e2e/playwright.config.ts:10-16 and
 * tools/design-review/src/{templates,editor}.ts: this sandboxed dev
 * environment pre-installs Chromium at a revision Playwright's own resolver
 * doesn't expect, and points launches at it directly rather than triggering
 * a (blocked) download. CI and any normal machine have no such path and
 * fall back to Playwright's own resolved install, exactly as those callers
 * do — so this works unmodified in both places.
 */
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";

export function resolveChromiumExecutablePath(): string | undefined {
  return existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined;
}

/**
 * Launches one Chromium instance for the driver's whole session.
 * `--no-sandbox` matches tools/design-review's own launch args — this
 * sandboxed dev container has no working setuid sandbox helper, and CI
 * containers commonly don't either.
 */
export async function launchChromium(): Promise<Browser> {
  return chromium.launch({ executablePath: resolveChromiumExecutablePath(), args: ["--no-sandbox"] });
}
