#!/usr/bin/env -S node --import tsx
import { readFile } from "node:fs/promises";
import { Command as Program } from "commander";
import {
  accountSignup,
  accountVerifyEmail,
  assetList,
  assetUpload,
  availabilityGet,
  availabilitySet,
  bookingCancel,
  bookingList,
  build,
  calendarConnect,
  calendarDisconnect,
  calendarStatus,
  createContext,
  diff,
  devLogin,
  domainAdd,
  domainList,
  domainVerify,
  domainRemove,
  eject,
  eventSignupWidgetGet,
  eventSignupList,
  eventSignupExport,
  eventSignupDelete,
  exportBundle,
  exportSite,
  formConfigure,
  formGet,
  importSite,
  memberInvite,
  memberList,
  memberRemove,
  memberUpdateRole,
  pageCreate,
  pageGet,
  pageList,
  pageWrite,
  planCancel,
  planUpgrade,
  postCreate,
  postGet,
  postList,
  postWrite,
  preview,
  publishCreate,
  publishList,
  publishRollback,
  pull,
  push,
  siteCreate,
  siteCreateFromTemplate,
  siteGet,
  siteList,
  siteOutline,
  stripeConnect,
  stripeDisconnect,
  stripeStatus,
  submissionDelete,
  submissionExport,
  submissionList,
  subscriptionGet,
  templateList,
  themeGet,
  themeSet,
  tokenCreate,
  type CommandContext,
} from "@prefab/commands";
import { runCommand, type GlobalOptions } from "./output.js";
import { readConfig, writeConfig } from "./config.js";

const program = new Program();
program.name("prefab").description("The prefab CLI — full mutation parity with the editor (ADR-0003)").version("0.0.0");
program.option("--json", "machine-readable output on stdout, errors as JSON on stderr (R13)");
program.option("--api-url <url>", "override PREFAB_API_URL");
program.option("--token <token>", "override PREFAB_TOKEN");

function globalOptions(): GlobalOptions {
  return { json: Boolean(program.opts().json) };
}

async function resolveContext(): Promise<CommandContext> {
  const opts = program.opts();
  const apiUrl = opts.apiUrl ?? process.env.PREFAB_API_URL ?? "http://localhost:8787";
  const token = opts.token ?? process.env.PREFAB_TOKEN;
  if (token) return createContext({ apiUrl, token });
  const config = await readConfig();
  return createContext({ apiUrl, cookie: config.cookie });
}

function bundleStoreDir(): string {
  return process.env.BUNDLE_STORE_DIR ?? ".data/bundles";
}

program
  .command("login <email>")
  .description("Log in as a seeded dev account (slice 1 stand-in for real signup) — needed for `site create`/`token create`")
  .action((email: string) =>
    runCommand(globalOptions(), async () => {
      const apiUrl = program.opts().apiUrl ?? process.env.PREFAB_API_URL ?? "http://localhost:8787";
      const ctx = createContext({ apiUrl });
      const result = await devLogin.run(ctx, { email });
      const cookie = ctx.api.getSessionCookie();
      if (cookie) await writeConfig({ apiUrl, cookie });
      return result;
    }),
  );

program
  .command("signup <email>")
  .description("Real signup (Slice 3): emails a 6-digit verification code — follow with `verify`")
  .action((email: string) => runCommand(globalOptions(), async () => accountSignup.run(await resolveContext(), { email })));

program
  .command("verify <email> <code>")
  .description("Verify a signup code and start a session — the real-signup equivalent of `login`")
  .action((email: string, code: string) =>
    runCommand(globalOptions(), async () => {
      const apiUrl = program.opts().apiUrl ?? process.env.PREFAB_API_URL ?? "http://localhost:8787";
      const ctx = createContext({ apiUrl });
      const result = await accountVerifyEmail.run(ctx, { email, code });
      const cookie = ctx.api.getSessionCookie();
      if (cookie) await writeConfig({ apiUrl, cookie });
      return result;
    }),
  );

const template = program.command("template").description("Browse and fork templates (ADR-0011)");
template
  .command("list")
  .description("List the templates available to fork a new site from")
  .action(() => runCommand(globalOptions(), async () => templateList.run(await resolveContext(), {})));
template
  .command("use <templateId> <slug> <name>")
  .description("Fork a template into a new site — every page and block gets a fresh id")
  .action((templateId, slug, name) =>
    runCommand(globalOptions(), async () => siteCreateFromTemplate.run(await resolveContext(), { templateId, slug, name })),
  );

const domain = program.command("domain").description("Manage custom domains (Slice 4, ADR-0007)");
domain
  .command("add <siteId> <hostname>")
  .description("Add a custom domain — returns the DNS record to add")
  .action((siteId, hostname) => runCommand(globalOptions(), async () => domainAdd.run(await resolveContext(), { siteId, hostname })));
domain
  .command("list <siteId>")
  .description("List a site's custom domains and their status")
  .action((siteId) => runCommand(globalOptions(), async () => domainList.run(await resolveContext(), { siteId })));
domain
  .command("verify <siteId> <domainId>")
  .description("Re-check a domain's DNS/certificate status now")
  .action((siteId, domainId) => runCommand(globalOptions(), async () => domainVerify.run(await resolveContext(), { siteId, domainId })));
domain
  .command("remove <siteId> <domainId>")
  .description("Remove a custom domain — deprovisions the certificate and stops serving there")
  .action((siteId, domainId) => runCommand(globalOptions(), async () => domainRemove.run(await resolveContext(), { siteId, domainId })));

const site = program.command("site").description("Manage sites");
site
  .command("create <slug> <name>")
  .description("Create a new site, seeded with a default home page and Hero block")
  .action((slug, name) => runCommand(globalOptions(), async () => siteCreate.run(await resolveContext(), { slug, name })));
site
  .command("list")
  .description("List sites you own")
  .action(() => runCommand(globalOptions(), async () => siteList.run(await resolveContext(), {})));
site
  .command("get <siteId>")
  .description("Get a site by id")
  .action((siteId) => runCommand(globalOptions(), async () => siteGet.run(await resolveContext(), { siteId })));

const theme = program.command("theme").description("Manage a site's theme tokens");
theme
  .command("get <siteId>")
  .action((siteId) => runCommand(globalOptions(), async () => themeGet.run(await resolveContext(), { siteId })));
theme
  .command("set <siteId> <tokensJson>")
  .description("Replace theme tokens — tokensJson is a JSON-encoded ThemeTokens object")
  .action((siteId, tokensJson) =>
    runCommand(globalOptions(), async () => themeSet.run(await resolveContext(), { siteId, tokens: JSON.parse(tokensJson) })),
  );

const page = program.command("page").description("Manage pages");
page
  .command("create <siteId> <slug> <title>")
  .action((siteId, slug, title) =>
    runCommand(globalOptions(), async () => pageCreate.run(await resolveContext(), { siteId, slug, title })),
  );
page
  .command("list <siteId>")
  .action((siteId) => runCommand(globalOptions(), async () => pageList.run(await resolveContext(), { siteId })));
page
  .command("get <siteId> <pageId>")
  .action((siteId, pageId) => runCommand(globalOptions(), async () => pageGet.run(await resolveContext(), { siteId, pageId })));
page
  .command("write <siteId> <pageId> <title> <slug> <blocksJson> <expectedVersion>")
  .description(
    "Replace a page's title, slug and blocks directly — blocksJson is a JSON-encoded BlockNode[] (R17/R18). `push` is the file-based equivalent.",
  )
  .action((siteId, pageId, title, slug, blocksJson, expectedVersion) =>
    runCommand(globalOptions(), async () =>
      pageWrite.run(await resolveContext(), {
        siteId,
        pageId,
        title,
        slug,
        blocks: JSON.parse(blocksJson),
        expectedVersion: Number(expectedVersion),
      }),
    ),
  );

const post = program.command("post").description("Manage blog posts (Slice 5)");
post
  .command("create <siteId> <title>")
  .description("Create a new blog post — the slug is generated from the title unless --slug is given")
  .option("--slug <slug>", "explicit slug instead of one generated from the title")
  .option("--date <date>", "YYYY-MM-DD, defaults to today")
  .option("--author <author>")
  .option("--status <status>", "draft or published", "draft")
  .action((siteId, title, options: { slug?: string; date?: string; author?: string; status?: "draft" | "published" }) =>
    runCommand(globalOptions(), async () =>
      postCreate.run(await resolveContext(), {
        siteId,
        title,
        slug: options.slug,
        date: options.date,
        author: options.author,
        status: options.status,
      }),
    ),
  );
post
  .command("list <siteId>")
  .description("List a site's blog posts")
  .option("--limit <limit>", "page size")
  .option("--offset <offset>")
  .option("--status <status>", "filter by draft or published")
  .action((siteId, options: { limit?: string; offset?: string; status?: "draft" | "published" }) =>
    runCommand(globalOptions(), async () =>
      postList.run(await resolveContext(), {
        siteId,
        limit: options.limit ? Number(options.limit) : undefined,
        offset: options.offset ? Number(options.offset) : undefined,
        status: options.status,
      }),
    ),
  );
post
  .command("get <siteId> <postId>")
  .action((siteId, postId) => runCommand(globalOptions(), async () => postGet.run(await resolveContext(), { siteId, postId })));
post
  .command("write <siteId> <postId> <title> <slug> <date> <status> <bodyFile> <expectedVersion>")
  .description(
    "Replace a post's fields directly, reading its Markdown body from a file (R17/R18). `push` is the file-checkout equivalent.",
  )
  .option("--author <author>", "", "")
  .option("--tags <tags>", "comma-separated")
  .option("--cover <cover>")
  .action(
    (
      siteId,
      postId,
      title,
      slug,
      date,
      status,
      bodyFile,
      expectedVersion,
      options: { author?: string; tags?: string; cover?: string },
    ) =>
      runCommand(globalOptions(), async () => {
        const body = await readFile(bodyFile, "utf8");
        return postWrite.run(await resolveContext(), {
          siteId,
          postId,
          title,
          slug,
          date,
          status,
          body,
          author: options.author ?? "",
          tags: options.tags ? options.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
          cover: options.cover ?? null,
          locale: "en",
          expectedVersion: Number(expectedVersion),
        });
      }),
  );

const form = program.command("form").description("Manage Form block notifications, webhooks and submissions (Slice 6)");
form
  .command("configure <siteId> <formId>")
  .description("Set a form's notification email and/or webhook URL — pass an empty string to clear one")
  .option("--notify-email <email>", "where a new submission is emailed")
  .option("--webhook-url <url>", "where a new submission is POSTed")
  .option("--webhook-secret <secret>", "sent as the x-prefab-webhook-secret header")
  .action((siteId, formId, options: { notifyEmail?: string; webhookUrl?: string; webhookSecret?: string }) =>
    runCommand(globalOptions(), async () =>
      formConfigure.run(await resolveContext(), {
        siteId,
        formId,
        notifyEmail: options.notifyEmail === "" ? null : options.notifyEmail,
        webhookUrl: options.webhookUrl === "" ? null : options.webhookUrl,
        webhookSecret: options.webhookSecret === "" ? null : options.webhookSecret,
      }),
    ),
  );
form
  .command("get <siteId> <formId>")
  .description("Show a form's published field manifest and current settings")
  .action((siteId, formId) => runCommand(globalOptions(), async () => formGet.run(await resolveContext(), { siteId, formId })));

const submission = program.command("submission").description("Manage a form's submissions (Slice 6)");
submission
  .command("list <siteId> <formId>")
  .description("List a form's submissions")
  .option("--limit <limit>", "page size")
  .option("--offset <offset>")
  .action((siteId, formId, options: { limit?: string; offset?: string }) =>
    runCommand(globalOptions(), async () =>
      submissionList.run(await resolveContext(), {
        siteId,
        formId,
        limit: options.limit ? Number(options.limit) : undefined,
        offset: options.offset ? Number(options.offset) : undefined,
      }),
    ),
  );
submission
  .command("export <siteId> <formId>")
  .description("Export a form's submissions — CSV by default")
  .option("--format <format>", "csv or json", "csv")
  .action((siteId, formId, options: { format?: "csv" | "json" }) =>
    runCommand(globalOptions(), async () => submissionExport.run(await resolveContext(), { siteId, formId, format: options.format })),
  );
submission
  .command("delete <siteId> <formId> <submissionId>")
  .description("Delete a single submission — PDPA/GDPR per-record deletion")
  .action((siteId, formId, submissionId) =>
    runCommand(globalOptions(), async () => submissionDelete.run(await resolveContext(), { siteId, formId, submissionId })),
  );

const eventSignupWidget = program.command("event-signup-widget").description("Inspect an event sign-up (RSVP) block's published widget (KAN-1138)");
eventSignupWidget
  .command("get <siteId> <widgetId>")
  .description("Show an event sign-up widget's published manifest (heading/fields/capacity/waitlist)")
  .action((siteId, widgetId) => runCommand(globalOptions(), async () => eventSignupWidgetGet.run(await resolveContext(), { siteId, widgetId })));

const eventSignup = program.command("event-signup").description("Manage an event sign-up widget's sign-ups (KAN-1138)");
eventSignup
  .command("list <siteId> <widgetId>")
  .description("List an event sign-up widget's sign-ups")
  .option("--limit <limit>", "page size")
  .option("--offset <offset>")
  .action((siteId, widgetId, options: { limit?: string; offset?: string }) =>
    runCommand(globalOptions(), async () =>
      eventSignupList.run(await resolveContext(), {
        siteId,
        widgetId,
        limit: options.limit ? Number(options.limit) : undefined,
        offset: options.offset ? Number(options.offset) : undefined,
      }),
    ),
  );
eventSignup
  .command("export <siteId> <widgetId>")
  .description("Export an event sign-up widget's sign-ups — CSV by default")
  .option("--format <format>", "csv or json", "csv")
  .action((siteId, widgetId, options: { format?: "csv" | "json" }) =>
    runCommand(globalOptions(), async () => eventSignupExport.run(await resolveContext(), { siteId, widgetId, format: options.format })),
  );
eventSignup
  .command("delete <siteId> <widgetId> <signupId>")
  .description("Delete a single event sign-up — PDPA/GDPR per-record deletion")
  .action((siteId, widgetId, signupId) =>
    runCommand(globalOptions(), async () => eventSignupDelete.run(await resolveContext(), { siteId, widgetId, signupId })),
  );

const asset = program.command("asset").description("Manage site assets (content-addressed uploads)");
asset
  .command("upload <siteId> <filePath>")
  .description("Upload a local file as a site asset — deduplicated by sha256")
  .action((siteId, filePath) =>
    runCommand(globalOptions(), async () => assetUpload.run(await resolveContext(), { siteId, filePath })),
  );
asset
  .command("list <siteId>")
  .description("List a site's uploaded assets")
  .action((siteId) => runCommand(globalOptions(), async () => assetList.run(await resolveContext(), { siteId })));

const member = program.command("member").description("Manage a site's owner/editor/viewer roles (Slice 8)");
member
  .command("invite <siteId> <email> <role>")
  .description("Invite an existing account as editor or viewer — the invited email must already have a prefab account")
  .action((siteId, email, role: "editor" | "viewer") =>
    runCommand(globalOptions(), async () => memberInvite.run(await resolveContext(), { siteId, email, role })),
  );
member
  .command("list <siteId>")
  .description("List a site's members and their roles")
  .action((siteId) => runCommand(globalOptions(), async () => memberList.run(await resolveContext(), { siteId })));
member
  .command("set-role <siteId> <accountId> <role>")
  .description("Change an invited member's role — the site owner's own role cannot be changed this way")
  .action((siteId, accountId, role: "editor" | "viewer") =>
    runCommand(globalOptions(), async () => memberUpdateRole.run(await resolveContext(), { siteId, accountId, role })),
  );
member
  .command("remove <siteId> <accountId>")
  .description("Remove an invited member — the site owner cannot be removed this way")
  .action((siteId, accountId) => runCommand(globalOptions(), async () => memberRemove.run(await resolveContext(), { siteId, accountId })));

const plan = program.command("plan").description("Manage this platform's own subscription plan (Slice 8, ADR-0012) — never a tenant's own BYO-Stripe (ADR-0005)");
plan
  .command("get")
  .description("Show the signed-in account's plan and subscription state")
  .action(() => runCommand(globalOptions(), async () => subscriptionGet.run(await resolveContext(), {})));
plan
  .command("upgrade")
  .description("Start (or complete, if already pro) an upgrade to the pro plan — prints a checkout URL when one is needed")
  .action(() => runCommand(globalOptions(), async () => planUpgrade.run(await resolveContext(), {})));
plan
  .command("cancel")
  .description("Cancel the pro plan — data and export keep working for a 30-day retention window (R7)")
  .action(() => runCommand(globalOptions(), async () => planCancel.run(await resolveContext(), {})));

const availability = program.command("availability").description("Manage a site's booking availability (Slice 9, ADR-0009)");
availability
  .command("set <siteId> <configJson>")
  .description("Replace a site's availability rule — configJson is a JSON-encoded {timezone, weeklyWindows, dateOverrides, slotDurationMinutes, bufferBeforeMinutes, bufferAfterMinutes, minNoticeMinutes, maxHorizonDays}")
  .action((siteId, configJson) =>
    runCommand(globalOptions(), async () => availabilitySet.run(await resolveContext(), { siteId, ...JSON.parse(configJson) })),
  );
availability
  .command("get <siteId>")
  .description("Show a site's current availability rule")
  .action((siteId) => runCommand(globalOptions(), async () => availabilityGet.run(await resolveContext(), { siteId })));

const booking = program.command("booking").description("Manage a site's bookings (Slice 9)");
booking
  .command("list <siteId>")
  .option("--limit <n>", "max results", (v) => Number.parseInt(v, 10))
  .option("--offset <n>", "pagination offset", (v) => Number.parseInt(v, 10))
  .option("--status <status>", "filter by status: confirmed or canceled")
  .description("List a site's bookings")
  .action((siteId, options: { limit?: number; offset?: number; status?: "confirmed" | "canceled" }) =>
    runCommand(globalOptions(), async () => bookingList.run(await resolveContext(), { siteId, ...options })),
  );
booking
  .command("cancel <siteId> <bookingId>")
  .description("Cancel a booking as the site owner — releases the slot and best-effort updates the visitor's calendar invite")
  .action((siteId, bookingId) => runCommand(globalOptions(), async () => bookingCancel.run(await resolveContext(), { siteId, bookingId })));

const calendar = program.command("calendar").description("Manage a site's two-way calendar sync (Slice 9)");
calendar
  .command("connect <siteId> <provider>")
  .option("--code <authorizationCode>", "a pre-obtained OAuth authorization code (real providers only)")
  .option("--redirect-uri <uri>", "the redirect URI used to obtain the code (real providers only)")
  .description("Connect Google Calendar or Microsoft 365 for two-way sync — provider is 'google' or 'microsoft'")
  .action((siteId, provider: "google" | "microsoft", options: { code?: string; redirectUri?: string }) =>
    runCommand(globalOptions(), async () =>
      calendarConnect.run(await resolveContext(), { siteId, provider, authorizationCode: options.code, redirectUri: options.redirectUri }),
    ),
  );
calendar
  .command("disconnect <siteId>")
  .description("Disconnect a site's calendar sync")
  .action((siteId) => runCommand(globalOptions(), async () => calendarDisconnect.run(await resolveContext(), { siteId })));
calendar
  .command("status <siteId>")
  .description("Show a site's calendar connection status")
  .action((siteId) => runCommand(globalOptions(), async () => calendarStatus.run(await resolveContext(), { siteId })));

const stripe = program.command("stripe").description("Manage a site's own bring-your-own Stripe account for one-off payment blocks (Slice 10 / KAN-1137, ADR-0005)");
stripe
  .command("connect <siteId> <authorizationCode>")
  .description("Connect a site's own Stripe account — authorizationCode is a pre-obtained OAuth code (real providers only; the fake accepts any string)")
  .action((siteId, authorizationCode) => runCommand(globalOptions(), async () => stripeConnect.run(await resolveContext(), { siteId, authorizationCode })));
stripe
  .command("disconnect <siteId>")
  .description("Disconnect a site's own Stripe account")
  .action((siteId) => runCommand(globalOptions(), async () => stripeDisconnect.run(await resolveContext(), { siteId })));
stripe
  .command("status <siteId>")
  .description("Show a site's Stripe connection status")
  .action((siteId) => runCommand(globalOptions(), async () => stripeStatus.run(await resolveContext(), { siteId })));

program
  .command("token-create <siteId> <name>")
  .description("Mint a new per-site scoped API token — the raw token is shown once")
  .action((siteId, name) => runCommand(globalOptions(), async () => tokenCreate.run(await resolveContext(), { siteId, name })));

program
  .command("outline <siteId>")
  .description("Every page and block as a compact tree — orient on an unfamiliar site in one call (R14)")
  .action((siteId) => runCommand(globalOptions(), async () => siteOutline.run(await resolveContext(), { siteId })));

program
  .command("publish <siteId>")
  .description("Build and go live (R4)")
  .action((siteId) => runCommand(globalOptions(), async () => publishCreate.run(await resolveContext(), { siteId })));
program
  .command("rollback <siteId> <publishId>")
  .description("Restore any previous publish in one action (R5)")
  .action((siteId, publishId) =>
    runCommand(globalOptions(), async () => publishRollback.run(await resolveContext(), { siteId, publishId })),
  );
program
  .command("publishes <siteId>")
  .description("List publish history")
  .action((siteId) => runCommand(globalOptions(), async () => publishList.run(await resolveContext(), { siteId })));

program
  .command("pull <siteId> [dir]")
  .description("Materialise a site as readable files on disk")
  .action((siteId, dir = ".") => runCommand(globalOptions(), async () => pull.run(await resolveContext(), { siteId, dir })));
program
  .command("push [dir]")
  .description("Send a local checkout back through validation and the version check")
  .action((dir = ".") => runCommand(globalOptions(), async () => push.run(await resolveContext(), { dir })));
program
  .command("export <siteId> [dir]")
  .description("Export a site as a portable file tree — free, on every plan, always (R7)")
  .action((siteId, dir = ".") =>
    runCommand(globalOptions(), async () => exportSite.run(await resolveContext(), { siteId, dir })),
  );
program
  .command("import [dir]")
  .description("Import a file tree (a fresh export, a template, hand edits) — same validation as any other write")
  .action((dir = ".") => runCommand(globalOptions(), async () => importSite.run(await resolveContext(), { dir })));
program
  .command("diff [dir]")
  .description("Show local checkout against the site's current remote state")
  .action((dir = ".") => runCommand(globalOptions(), async () => diff.run(await resolveContext(), { dir })));

program
  .command("export-bundle <siteId> <outDir>")
  .description("Export tier (a) (ADR-0010): a self-contained static bundle plus an import manifest — free, on every plan (R7)")
  .option("--runtime-api-url <url>", "where this export's Form island(s) will post submissions once served (self-host it with apps/self-host)")
  .option("--base-url <url>", "anchors RSS/sitemap absolute links")
  .action((siteId, outDir, options: { runtimeApiUrl?: string; baseUrl?: string }) =>
    runCommand(globalOptions(), async () =>
      exportBundle.run(await resolveContext(), {
        siteId,
        outDir,
        bundleStoreDir: bundleStoreDir(),
        runtimeApiUrl: options.runtimeApiUrl,
        baseUrl: options.baseUrl,
      }),
    ),
  );
program
  .command("eject <siteId> <outDir>")
  .description("Export tier (c) (ADR-0010): generate a standalone Astro project — npm install && npm run build, no pre-fab package required at runtime (R11)")
  .option("--runtime-api-url <url>", "where this export's Form island(s) will post submissions once served (self-host it with apps/self-host)")
  .action((siteId, outDir, options: { runtimeApiUrl?: string }) =>
    runCommand(globalOptions(), async () =>
      eject.run(await resolveContext(), { siteId, outDir, runtimeApiUrl: options.runtimeApiUrl }),
    ),
  );

program
  .command("build [dir]")
  .description("Build a local checkout to a static bundle — no network required (R16)")
  .action((dir = ".") =>
    runCommand(globalOptions(), async () => build.run(await resolveContext(), { dir, bundleStoreDir: bundleStoreDir() })),
  );
program
  .command("preview [dir]")
  .description("Build and serve a local checkout, with a stable URL and a screenshot (R15/R16)")
  .option("--no-screenshot", "skip Chromium screenshot capture")
  .action((dir = ".", options: { screenshot: boolean }) =>
    runCommand(globalOptions(), async () => {
      const result = await preview.run(await resolveContext(), {
        dir,
        bundleStoreDir: bundleStoreDir(),
        screenshot: options.screenshot,
      });
      // The listening server is itself an active handle, so returning here
      // (rather than blocking on a never-resolving promise) already keeps
      // the process alive — printing the URL/screenshot promptly is what
      // R15 asks for. Ctrl+C (SIGINT) is the normal way to stop it.
      process.on("SIGINT", () => {
        void result.close().then(() => process.exit(0));
      });
      const { close: _close, ...jsonSafeResult } = result;
      return jsonSafeResult;
    }),
  );

await program.parseAsync(process.argv);
