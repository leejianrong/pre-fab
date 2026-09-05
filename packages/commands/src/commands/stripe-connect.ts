import type { Command } from "../registry.js";
import type { ConnectStripeInput, StripeConnectionStatus } from "@prefab/api-client";

export const stripeConnect: Command<{ siteId: string } & ConnectStripeInput, StripeConnectionStatus> = {
  name: "stripe.connect",
  mutation: "stripe.connect",
  description: "Connect a site's own Stripe account for one-off payment blocks (Slice 10 / KAN-1137, ADR-0005 — bring-your-own, zero platform fee) — real providers need a pre-obtained OAuth authorizationCode",
  run: (ctx, args) => {
    const { siteId, ...input } = args;
    return ctx.api.connectStripe(siteId, input);
  },
};

export const stripeDisconnect: Command<{ siteId: string }, { removed: true }> = {
  name: "stripe.disconnect",
  mutation: "stripe.disconnect",
  description: "Disconnect a site's own Stripe account",
  run: (ctx, args) => ctx.api.disconnectStripe(args.siteId),
};

export const stripeStatus: Command<{ siteId: string }, StripeConnectionStatus | null> = {
  name: "stripe.status",
  description: "Get a site's Stripe connection status — connected account id and connected/error, never the access token",
  run: (ctx, args) => ctx.api.getStripeStatus(args.siteId),
};
