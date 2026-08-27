import { defineRegistry } from "../registry.js";
import { devLogin } from "./login.js";
import { siteCreate, siteGet, siteList } from "./site.js";
import { themeGet, themeSet } from "./theme.js";
import { pageCreate, pageGet, pageList, pageWrite } from "./page.js";
import { tokenCreate } from "./token.js";
import { siteOutline } from "./outline.js";
import { publishCreate, publishList, publishRollback } from "./publish.js";
import { pull, exportSite } from "./pull.js";
import { push, importSite } from "./push.js";
import { diff } from "./diff.js";
import { build } from "./build.js";
import { preview } from "./preview.js";

/**
 * Every command apps/cli and apps/mcp expose, in one place. Both wrap this
 * list mechanically rather than reimplementing commands — that mechanical
 * wrapping is what keeps MCP from drifting off the CLI (ADR-0003).
 */
export const commandRegistry = defineRegistry([
  devLogin,
  siteCreate,
  siteList,
  siteGet,
  themeGet,
  themeSet,
  pageCreate,
  pageList,
  pageGet,
  pageWrite,
  tokenCreate,
  siteOutline,
  publishCreate,
  publishList,
  publishRollback,
  pull,
  exportSite,
  push,
  importSite,
  diff,
  build,
  preview,
]);

export {
  devLogin,
  siteCreate,
  siteList,
  siteGet,
  themeGet,
  themeSet,
  pageCreate,
  pageList,
  pageGet,
  pageWrite,
  tokenCreate,
  siteOutline,
  publishCreate,
  publishList,
  publishRollback,
  pull,
  exportSite,
  push,
  importSite,
  diff,
  build,
  preview,
};
