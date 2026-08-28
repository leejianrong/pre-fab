#!/usr/bin/env -S node --import tsx
import { Command as Program } from "commander";
import {
  accountSignup,
  accountVerifyEmail,
  assetList,
  assetUpload,
  build,
  createContext,
  diff,
  devLogin,
  domainAdd,
  domainList,
  domainVerify,
  domainRemove,
  exportSite,
  importSite,
  pageCreate,
  pageGet,
  pageList,
  pageWrite,
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
