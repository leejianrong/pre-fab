import type { Command } from "../registry.js";
import type { SiteMember } from "@prefab/api-client";

export const memberInvite: Command<{ siteId: string; email: string; role: "editor" | "viewer" }, SiteMember> = {
  name: "member.invite",
  mutation: "member.invite",
  description: "Invite an existing account as an editor or viewer on a site (Slice 8) — the invited email must already have a prefab account",
  run: (ctx, args) => ctx.api.inviteMember(args.siteId, { email: args.email, role: args.role }),
};

export const memberList: Command<{ siteId: string }, SiteMember[]> = {
  name: "member.list",
  description: "List a site's members and their roles (owner/editor/viewer)",
  run: (ctx, args) => ctx.api.listMembers(args.siteId),
};

export const memberUpdateRole: Command<{ siteId: string; accountId: string; role: "editor" | "viewer" }, SiteMember> = {
  name: "member.updateRole",
  mutation: "member.updateRole",
  description: "Change an invited member's role — the site owner's own role cannot be changed this way",
  run: (ctx, args) => ctx.api.updateMemberRole(args.siteId, args.accountId, args.role),
};

export const memberRemove: Command<{ siteId: string; accountId: string }, { removed: true }> = {
  name: "member.remove",
  mutation: "member.remove",
  description: "Remove an invited member from a site — the site owner cannot be removed this way",
  run: (ctx, args) => ctx.api.removeMember(args.siteId, args.accountId),
};
