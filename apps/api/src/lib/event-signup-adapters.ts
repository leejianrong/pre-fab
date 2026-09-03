import { createEventSignup, getEventSignupWidgetPublic, withTenantContext, type Pool } from "@prefab/db";
import type { EventSignupStore, EventSignupWidgetStore } from "@prefab/runtime";

/**
 * The Postgres-backed halves of @prefab/runtime's KAN-1138 storage
 * interfaces (ADR-0010) — apps/api is the control plane, so it's the one
 * place allowed to know these are backed by Postgres and @prefab/db at all.
 * Mirrors runtime-adapters.ts (Slice 6) exactly.
 */
export function createPostgresEventSignupWidgetStore(pool: Pool): EventSignupWidgetStore {
  return {
    // No tenant context: this is the runtime's own public sign-up path,
    // resolving a widgetId with no signed-in principal — see
    // `event_signup_widgets_public_read`'s RLS policy (0009_slice10_events.sql).
    async getWidget(widgetId) {
      return withTenantContext(pool, {}, (client) => getEventSignupWidgetPublic(client, widgetId));
    },
  };
}

export function createPostgresEventSignupStore(pool: Pool): EventSignupStore {
  return {
    async create(input) {
      const result = await withTenantContext(pool, { siteId: input.siteId }, (client) =>
        createEventSignup(client, {
          id: input.id,
          widgetId: input.widgetId,
          siteId: input.siteId,
          values: input.values,
          capacity: input.capacity,
          waitlistEnabled: input.waitlistEnabled,
        }),
      );
      if (result.status === "full") return { status: "full" };
      const record = {
        id: result.signup.id,
        widgetId: result.signup.widgetId,
        siteId: result.signup.siteId,
        values: result.signup.values as Record<string, string | boolean>,
        status: result.signup.status,
        position: result.signup.position,
        createdAt: result.signup.createdAt.toISOString(),
      };
      if (result.status === "waitlisted") return { status: "waitlisted", signup: record, position: result.position };
      return { status: "confirmed", signup: record };
    },
  };
}
