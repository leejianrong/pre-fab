import type { Command } from "../registry.js";
import type {
  ConfigureFormInput,
  FormSettings,
  FormWithSettings,
  ListSubmissionsQuery,
  ListSubmissionsResult,
} from "@prefab/api-client";

export const formConfigure: Command<{ siteId: string; formId: string } & ConfigureFormInput, FormSettings> = {
  name: "form.configure",
  mutation: "form.configure",
  description: "Set a Form block's notification email and/or webhook URL (Slice 6) — field definitions live in the block itself, edited via page.write",
  run: (ctx, args) => {
    const { siteId, formId, ...input } = args;
    return ctx.api.configureForm(siteId, formId, input);
  },
};

export const formGet: Command<{ siteId: string; formId: string }, FormWithSettings> = {
  name: "form.get",
  description: "Get a form's published field manifest and its current notification/webhook settings",
  run: (ctx, args) => ctx.api.getForm(args.siteId, args.formId),
};

export const submissionList: Command<{ siteId: string; formId: string } & ListSubmissionsQuery, ListSubmissionsResult> = {
  name: "submission.list",
  description: "List a form's submissions, paginated",
  run: (ctx, args) => {
    const { siteId, formId, ...query } = args;
    return ctx.api.listSubmissions(siteId, formId, query);
  },
};

export const submissionExport: Command<{ siteId: string; formId: string; format?: "csv" | "json" }, string> = {
  name: "submission.export",
  description: "Export a form's submissions as CSV or JSON (default CSV)",
  run: async (ctx, args) => {
    if (args.format === "json") return JSON.stringify(await ctx.api.exportSubmissionsJson(args.siteId, args.formId), null, 2);
    return ctx.api.exportSubmissionsCsv(args.siteId, args.formId);
  },
};

export const submissionDelete: Command<{ siteId: string; formId: string; submissionId: string }, { removed: true }> = {
  name: "submission.delete",
  mutation: "submission.delete",
  description: "Delete a single submission — PDPA/GDPR per-record deletion (Slice 6)",
  run: (ctx, args) => ctx.api.deleteSubmission(args.siteId, args.formId, args.submissionId),
};
