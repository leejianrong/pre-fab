/**
 * The single source of truth for "every mutation exposed by the HTTP API"
 * (R12 / ADR-0003). src/app.ts registers each route FROM this list rather
 * than the list describing routes registered elsewhere, so the manifest and
 * reality cannot drift. tools/checks' parity script imports this module —
 * and only this module, no fastify/db — to check @prefab/commands covers
 * every entry, without booting a server or a database.
 */
export const API_MUTATIONS = [
  { name: "account.signup", method: "POST", path: "/v1/signup" },
  { name: "account.verifyEmail", method: "POST", path: "/v1/signup/verify" },
  { name: "site.create", method: "POST", path: "/v1/sites" },
  { name: "site.createFromTemplate", method: "POST", path: "/v1/templates/:templateId/use" },
  { name: "theme.update", method: "PUT", path: "/v1/sites/:siteId/theme" },
  { name: "page.create", method: "POST", path: "/v1/sites/:siteId/pages" },
  { name: "page.write", method: "PUT", path: "/v1/sites/:siteId/pages/:pageId" },
  { name: "post.create", method: "POST", path: "/v1/sites/:siteId/posts" },
  { name: "post.write", method: "PUT", path: "/v1/sites/:siteId/posts/:postId" },
  // ---- KAN-1244 / ADR-0018: the product catalogue collection ----
  { name: "product.create", method: "POST", path: "/v1/sites/:siteId/products" },
  { name: "product.write", method: "PUT", path: "/v1/sites/:siteId/products/:productId" },
  { name: "asset.upload", method: "POST", path: "/v1/sites/:siteId/assets" },
  { name: "token.create", method: "POST", path: "/v1/sites/:siteId/tokens" },
  { name: "domain.add", method: "POST", path: "/v1/sites/:siteId/domains" },
  { name: "domain.verify", method: "POST", path: "/v1/sites/:siteId/domains/:domainId/verify" },
  { name: "domain.remove", method: "DELETE", path: "/v1/sites/:siteId/domains/:domainId" },
  { name: "publish.create", method: "POST", path: "/v1/sites/:siteId/publish" },
  { name: "publish.rollback", method: "POST", path: "/v1/sites/:siteId/publishes/:publishId/rollback" },
  { name: "form.configure", method: "PUT", path: "/v1/sites/:siteId/forms/:formId" },
  { name: "submission.delete", method: "DELETE", path: "/v1/sites/:siteId/forms/:formId/submissions/:submissionId" },
  // ---- Slice 8: accounts, plans and billing (ADR-0005, ADR-0012) ----
  { name: "member.invite", method: "POST", path: "/v1/sites/:siteId/members" },
  { name: "member.updateRole", method: "PUT", path: "/v1/sites/:siteId/members/:accountId" },
  { name: "member.remove", method: "DELETE", path: "/v1/sites/:siteId/members/:accountId" },
  { name: "plan.upgrade", method: "POST", path: "/v1/account/plan" },
  { name: "plan.cancel", method: "POST", path: "/v1/account/plan/cancel" },
  // ---- Slice 9: scheduling and bookings (ADR-0009) ----
  // booking.create/cancel/reschedule on a published site are runtime
  // mutations, not control-plane ones — they have no signed-in principal
  // (a visitor, not an owner) and so are deliberately absent from this
  // manifest, the same way submission.create isn't here either (see
  // /v1/runtime/forms/:formId/submissions). Only owner-authenticated,
  // dashboard-facing mutations are listed below.
  { name: "availability.set", method: "PUT", path: "/v1/sites/:siteId/availability" },
  { name: "booking.cancel", method: "POST", path: "/v1/sites/:siteId/bookings/:bookingId/cancel" },
  { name: "calendar.connect", method: "POST", path: "/v1/sites/:siteId/calendar" },
  { name: "calendar.disconnect", method: "DELETE", path: "/v1/sites/:siteId/calendar" },
  // ---- KAN-1138: event sign-ups ----
  // eventSignup.create on a published site is a runtime mutation, not a
  // control-plane one (no signed-in principal — a visitor, not an owner),
  // deliberately absent here for the same reason submission.create/
  // booking.create aren't either (see /v1/runtime/event-signups/:widgetId/signups).
  { name: "eventSignup.delete", method: "DELETE", path: "/v1/sites/:siteId/event-signups/:widgetId/signups/:signupId" },
  // ---- Slice 10 / KAN-1137: one-off payment blocks, bring-your-own
  // Stripe (ADR-0005). payment-blocks/:blockId/checkout on a published
  // site is a runtime mutation, not a control-plane one (no signed-in
  // principal — a visitor, not an owner), the identical reasoning
  // booking.create/submission.create are absent from this manifest too. ----
  { name: "stripe.connect", method: "POST", path: "/v1/sites/:siteId/stripe" },
  { name: "stripe.disconnect", method: "DELETE", path: "/v1/sites/:siteId/stripe" },
  // ---- KAN-1246 / ADR-0018 (part 3 addendum): orders, inventory and
  // fulfillment. order.list/order.get/order.export are non-mutating reads
  // (same reason product.list/product.get/submission.export aren't listed
  // here either) — order.markShipped is the one owner-driven status
  // transition this card wires a mutation for (see that ADR addendum's
  // point 6 for why "mark delivered" for a physical line isn't). ----
  { name: "order.markShipped", method: "POST", path: "/v1/sites/:siteId/orders/items/:orderItemId/ship" },
] as const;

export type MutationName = (typeof API_MUTATIONS)[number]["name"];
