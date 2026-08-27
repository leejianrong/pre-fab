import type { Command } from "../registry.js";

/** Not an API_MUTATIONS entry — slice 1 has no signup UI (SLICES.md); this only bootstraps a browser session for a seeded account. */
export const devLogin: Command<{ email: string }, { accountId: string }> = {
  name: "dev.login",
  description: "Log in as a seeded dev account (slice 1 stand-in for real signup)",
  run: (ctx, args) => ctx.api.devLogin(args.email),
};
