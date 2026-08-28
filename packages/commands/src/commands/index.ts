import { defineRegistry } from "../registry.js";
import { devLogin } from "./login.js";
import { accountSignup, accountVerifyEmail } from "./account.js";
import { siteCreate, siteGet, siteList } from "./site.js";
import { templateList, siteCreateFromTemplate } from "./template.js";
import { domainAdd, domainList, domainVerify, domainRemove } from "./domain.js";
import { themeGet, themeSet } from "./theme.js";
import { pageCreate, pageGet, pageList, pageWrite } from "./page.js";
import { postCreate, postGet, postList, postWrite } from "./post.js";
import { formConfigure, formGet, submissionList, submissionExport, submissionDelete } from "./form.js";
import { assetUpload, assetList } from "./asset.js";
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
  accountSignup,
  accountVerifyEmail,
  siteCreate,
  siteList,
  siteGet,
  templateList,
  siteCreateFromTemplate,
  domainAdd,
  domainList,
  domainVerify,
  domainRemove,
  themeGet,
  themeSet,
  pageCreate,
  pageList,
  pageGet,
  pageWrite,
  postCreate,
  postList,
  postGet,
  postWrite,
  formConfigure,
  formGet,
  submissionList,
  submissionExport,
  submissionDelete,
  assetUpload,
  assetList,
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
  accountSignup,
  accountVerifyEmail,
  siteCreate,
  siteList,
  siteGet,
  templateList,
  siteCreateFromTemplate,
  domainAdd,
  domainList,
  domainVerify,
  domainRemove,
  themeGet,
  themeSet,
  pageCreate,
  pageList,
  pageGet,
  pageWrite,
  postCreate,
  postList,
  postGet,
  postWrite,
  formConfigure,
  formGet,
  submissionList,
  submissionExport,
  submissionDelete,
  assetUpload,
  assetList,
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
