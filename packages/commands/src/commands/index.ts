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
import { eventSignupWidgetGet, eventSignupList, eventSignupExport, eventSignupDelete } from "./event-signup.js";
import { assetUpload, assetList } from "./asset.js";
import { tokenCreate } from "./token.js";
import { siteOutline } from "./outline.js";
import { publishCreate, publishList, publishRollback } from "./publish.js";
import { pull, exportSite } from "./pull.js";
import { push, importSite } from "./push.js";
import { diff } from "./diff.js";
import { build } from "./build.js";
import { preview } from "./preview.js";
import { exportBundle } from "./export-bundle.js";
import { eject } from "./eject.js";
import { memberInvite, memberList, memberUpdateRole, memberRemove } from "./member.js";
import { subscriptionGet, planUpgrade, planCancel } from "./plan.js";
import { availabilitySet, availabilityGet } from "./availability.js";
import { bookingList, bookingCancel } from "./booking.js";
import { calendarConnect, calendarDisconnect, calendarStatus } from "./calendar.js";

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
  eventSignupWidgetGet,
  eventSignupList,
  eventSignupExport,
  eventSignupDelete,
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
  exportBundle,
  eject,
  memberInvite,
  memberList,
  memberUpdateRole,
  memberRemove,
  subscriptionGet,
  planUpgrade,
  planCancel,
  availabilitySet,
  availabilityGet,
  bookingList,
  bookingCancel,
  calendarConnect,
  calendarDisconnect,
  calendarStatus,
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
  eventSignupWidgetGet,
  eventSignupList,
  eventSignupExport,
  eventSignupDelete,
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
  exportBundle,
  eject,
  memberInvite,
  memberList,
  memberUpdateRole,
  memberRemove,
  subscriptionGet,
  planUpgrade,
  planCancel,
  availabilitySet,
  availabilityGet,
  bookingList,
  bookingCancel,
  calendarConnect,
  calendarDisconnect,
  calendarStatus,
};
