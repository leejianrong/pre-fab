import type { Command } from "../registry.js";
import type { PublishRecord, PublishResult } from "@prefab/api-client";

export const publishCreate: Command<{ siteId: string }, PublishResult> = {
  name: "publish.create",
  mutation: "publish.create",
  description: "Build and go live (ADR-0007) — atomic pointer swap, so a failed build leaves the live site untouched (R4)",
  run: (ctx, args) => ctx.api.publish(args.siteId),
};

export const publishRollback: Command<{ siteId: string; publishId: string }, { publish: PublishRecord }> = {
  name: "publish.rollback",
  mutation: "publish.rollback",
  description: "Restore any previous publish in one action (R5)",
  run: (ctx, args) => ctx.api.rollback(args.siteId, args.publishId),
};

export const publishList: Command<{ siteId: string }, PublishRecord[]> = {
  name: "publish.list",
  description: "List publish history",
  run: (ctx, args) => ctx.api.listPublishes(args.siteId),
};
