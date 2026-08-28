import type { Command } from "../registry.js";
import type { DomainWithInstruction } from "@prefab/api-client";

export const domainAdd: Command<{ siteId: string; hostname: string }, DomainWithInstruction> = {
  name: "domain.add",
  mutation: "domain.add",
  description: "Add a custom domain to a site — returns the DNS record to add (Slice 4, ADR-0007)",
  run: (ctx, args) => ctx.api.addDomain(args.siteId, args.hostname),
};

export const domainList: Command<{ siteId: string }, DomainWithInstruction[]> = {
  name: "domain.list",
  description: "List a site's custom domains and their status",
  run: (ctx, args) => ctx.api.listDomains(args.siteId),
};

export const domainVerify: Command<{ siteId: string; domainId: string }, DomainWithInstruction> = {
  name: "domain.verify",
  mutation: "domain.verify",
  description: "Re-check a custom domain's DNS/certificate status now, rather than waiting for the next poll",
  run: (ctx, args) => ctx.api.verifyDomain(args.siteId, args.domainId),
};

export const domainRemove: Command<{ siteId: string; domainId: string }, { removed: true }> = {
  name: "domain.remove",
  mutation: "domain.remove",
  description: "Remove a custom domain — deprovisions the certificate and stops serving the site there",
  run: (ctx, args) => ctx.api.removeDomain(args.siteId, args.domainId),
};
