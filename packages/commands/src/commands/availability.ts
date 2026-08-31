import type { Command } from "../registry.js";
import type { AvailabilityRule, SetAvailabilityInput } from "@prefab/api-client";

export const availabilitySet: Command<{ siteId: string } & SetAvailabilityInput, AvailabilityRule> = {
  name: "availability.set",
  mutation: "availability.set",
  description: "Set a site's booking availability — weekly windows, date overrides, buffers, minimum notice and maximum horizon (Slice 9, ADR-0009)",
  run: (ctx, args) => {
    const { siteId, ...input } = args;
    return ctx.api.setAvailability(siteId, input);
  },
};

export const availabilityGet: Command<{ siteId: string }, AvailabilityRule | null> = {
  name: "availability.get",
  description: "Get a site's current booking availability configuration",
  run: (ctx, args) => ctx.api.getAvailability(args.siteId),
};
