import { newUlid } from "@prefab/schema";

/**
 * Two-way calendar sync (Google Calendar, Microsoft 365 — SLICES.md Slice
 * 9). Same shape as every other provider adapter in this file's siblings
 * (domain-provider.ts, stripe.ts, turnstile.ts, email.ts): an interface, an
 * in-memory fake that every automated test in this repo runs against by
 * default, a real adapter written from the provider's public docs and
 * explicitly flagged UNVERIFIED, and an env-gated factory that only ever
 * returns the real one when credentials are actually configured.
 *
 * No real Google or Microsoft developer account exists in this environment
 * (the same constraint as Cloudflare/Stripe/Resend/Turnstile) — `connect`
 * takes a pre-obtained OAuth authorization code (the owner completes the
 * provider's consent screen in the browser; the editor hands the resulting
 * code to `calendar.connect`) rather than driving the authorize redirect
 * itself, which keeps this adapter to exactly the token-exchange and API
 * calls it makes, consistent with RealStripeProvider/CloudflareDomainProvider
 * using bare `fetch`, never a vendor SDK.
 */

export interface CalendarEventInput {
  title: string;
  description: string;
  startsAtMs: number;
  endsAtMs: number;
  attendeeEmail: string;
  attendeeName: string;
}

export interface CalendarBusyBlock {
  startMs: number;
  endMs: number;
}

export interface CalendarTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  externalCalendarId: string | null;
}

export interface CalendarProvider {
  connect(input: { authorizationCode?: string; redirectUri?: string }): Promise<CalendarTokenSet>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }>;
  createEvent(accessToken: string, calendarId: string | null, input: CalendarEventInput): Promise<{ externalEventId: string }>;
  updateEvent(accessToken: string, calendarId: string | null, externalEventId: string, input: CalendarEventInput): Promise<void>;
  deleteEvent(accessToken: string, calendarId: string | null, externalEventId: string): Promise<void>;
  getBusyTimes(accessToken: string, calendarId: string | null, rangeStartMs: number, rangeEndMs: number): Promise<CalendarBusyBlock[]>;
}

interface FakeCalendarState {
  busy: CalendarBusyBlock[];
  unavailable: boolean;
  events: Map<string, CalendarEventInput>;
}

/**
 * In-memory and deterministic, exactly like FakeDomainProvider/
 * FakeStripeProvider. Keyed by `calendarId` (what `connect()` synthesizes
 * and every subsequent call is handed) rather than by site — this class has
 * no idea sites exist, matching how little a real provider's own client
 * knows. `setBusyTimes`/`setUnavailable` are what let a test (or the
 * dev-only `/v1/dev/calendar/:siteId/advance` route) simulate synced busy
 * time or a provider outage, the same "controllable from outside" shape
 * `FakeDomainProvider.advance()` gives DNS propagation.
 */
export class FakeCalendarProvider implements CalendarProvider {
  private readonly calendars = new Map<string, FakeCalendarState>();

  private stateFor(calendarId: string): FakeCalendarState {
    let state = this.calendars.get(calendarId);
    if (!state) {
      state = { busy: [], unavailable: false, events: new Map() };
      this.calendars.set(calendarId, state);
    }
    return state;
  }

  async connect(): Promise<CalendarTokenSet> {
    const calendarId = `fake-calendar-${newUlid()}`;
    this.stateFor(calendarId);
    return { accessToken: `fake-access-${newUlid()}`, refreshToken: `fake-refresh-${newUlid()}`, expiresAt: Date.now() + 3600_000, externalCalendarId: calendarId };
  }

  async refreshAccessToken(): Promise<{ accessToken: string; expiresAt: number }> {
    return { accessToken: `fake-access-${newUlid()}`, expiresAt: Date.now() + 3600_000 };
  }

  async createEvent(_accessToken: string, calendarId: string | null, input: CalendarEventInput): Promise<{ externalEventId: string }> {
    const state = this.stateFor(calendarId ?? "default");
    if (state.unavailable) throw new Error("FakeCalendarProvider: calendar unavailable");
    const externalEventId = `fake-event-${newUlid()}`;
    state.events.set(externalEventId, input);
    return { externalEventId };
  }

  async updateEvent(_accessToken: string, calendarId: string | null, externalEventId: string, input: CalendarEventInput): Promise<void> {
    const state = this.stateFor(calendarId ?? "default");
    if (state.unavailable) throw new Error("FakeCalendarProvider: calendar unavailable");
    state.events.set(externalEventId, input);
  }

  async deleteEvent(_accessToken: string, calendarId: string | null, externalEventId: string): Promise<void> {
    const state = this.stateFor(calendarId ?? "default");
    if (state.unavailable) throw new Error("FakeCalendarProvider: calendar unavailable");
    state.events.delete(externalEventId);
  }

  async getBusyTimes(_accessToken: string, calendarId: string | null, rangeStartMs: number, rangeEndMs: number): Promise<CalendarBusyBlock[]> {
    const state = this.stateFor(calendarId ?? "default");
    if (state.unavailable) throw new Error("FakeCalendarProvider: calendar unavailable");
    return state.busy.filter((b) => b.startMs < rangeEndMs && b.endMs > rangeStartMs);
  }

  /** Dev/test-only: seed synced busy blocks for a calendar. Never called from any production code path. */
  setBusyTimes(calendarId: string, busy: CalendarBusyBlock[]): void {
    this.stateFor(calendarId).busy = busy;
  }

  /** Dev/test-only: simulate the provider becoming unreachable (or recovering). */
  setUnavailable(calendarId: string, unavailable: boolean): void {
    this.stateFor(calendarId).unavailable = unavailable;
  }
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface GoogleEventResponse {
  id: string;
}

interface GoogleFreeBusyResponse {
  calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
}

/**
 * UNVERIFIED against a live Google account (see module comment above).
 * Written from Google Calendar API v3's documented endpoints:
 * https://developers.google.com/calendar/api/v3/reference/events
 * https://developers.google.com/calendar/api/v3/reference/freebusy/query
 * https://developers.google.com/identity/protocols/oauth2/web-server#exchange-authorization-code
 */
export class RealGoogleCalendarProvider implements CalendarProvider {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async connect(input: { authorizationCode?: string; redirectUri?: string }): Promise<CalendarTokenSet> {
    if (!input.authorizationCode) throw new Error("Google Calendar connect requires an OAuth authorization code");
    const response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.authorizationCode,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: input.redirectUri ?? "",
        grant_type: "authorization_code",
      }),
    });
    if (!response.ok) throw new Error(`Google OAuth token exchange failed (${response.status})`);
    const token = (await response.json()) as GoogleTokenResponse;
    if (!token.refresh_token) throw new Error("Google did not return a refresh_token — request access_type=offline, prompt=consent");
    return { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000, externalCalendarId: "primary" };
  }

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
    const response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: refreshToken, client_id: this.clientId, client_secret: this.clientSecret, grant_type: "refresh_token" }),
    });
    if (!response.ok) throw new Error(`Google OAuth token refresh failed (${response.status})`);
    const token = (await response.json()) as GoogleTokenResponse;
    return { accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  }

  private async request<T>(accessToken: string, method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`https://www.googleapis.com/calendar/v3${path}`, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`Google Calendar API error (${response.status}): ${await response.text().catch(() => "")}`);
    return (await response.json()) as T;
  }

  private toGoogleEvent(input: CalendarEventInput) {
    return {
      summary: input.title,
      description: input.description,
      start: { dateTime: new Date(input.startsAtMs).toISOString() },
      end: { dateTime: new Date(input.endsAtMs).toISOString() },
      attendees: [{ email: input.attendeeEmail, displayName: input.attendeeName }],
    };
  }

  async createEvent(accessToken: string, calendarId: string | null, input: CalendarEventInput): Promise<{ externalEventId: string }> {
    const created = await this.request<GoogleEventResponse>(accessToken, "POST", `/calendars/${calendarId ?? "primary"}/events`, this.toGoogleEvent(input));
    return { externalEventId: created.id };
  }

  async updateEvent(accessToken: string, calendarId: string | null, externalEventId: string, input: CalendarEventInput): Promise<void> {
    await this.request(accessToken, "PATCH", `/calendars/${calendarId ?? "primary"}/events/${externalEventId}`, this.toGoogleEvent(input));
  }

  async deleteEvent(accessToken: string, calendarId: string | null, externalEventId: string): Promise<void> {
    await this.request(accessToken, "DELETE", `/calendars/${calendarId ?? "primary"}/events/${externalEventId}`);
  }

  async getBusyTimes(accessToken: string, calendarId: string | null, rangeStartMs: number, rangeEndMs: number): Promise<CalendarBusyBlock[]> {
    const result = await this.request<GoogleFreeBusyResponse>(accessToken, "POST", "/freeBusy", {
      timeMin: new Date(rangeStartMs).toISOString(),
      timeMax: new Date(rangeEndMs).toISOString(),
      items: [{ id: calendarId ?? "primary" }],
    });
    const busy = result.calendars[calendarId ?? "primary"]?.busy ?? [];
    return busy.map((b) => ({ startMs: new Date(b.start).getTime(), endMs: new Date(b.end).getTime() }));
  }
}

interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface MicrosoftEventResponse {
  id: string;
}

interface MicrosoftScheduleResponse {
  value: Array<{ scheduleItems: Array<{ start: { dateTime: string }; end: { dateTime: string } }> }>;
}

/**
 * UNVERIFIED against a live Microsoft 365 tenant (see module comment
 * above). Written from Microsoft Graph's documented endpoints:
 * https://learn.microsoft.com/en-us/graph/api/user-post-events
 * https://learn.microsoft.com/en-us/graph/api/calendar-getschedule
 * https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
 */
export class RealMicrosoftCalendarProvider implements CalendarProvider {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly tenant: string = "common",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async connect(input: { authorizationCode?: string; redirectUri?: string }): Promise<CalendarTokenSet> {
    if (!input.authorizationCode) throw new Error("Microsoft 365 connect requires an OAuth authorization code");
    const response = await this.fetchImpl(`https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.authorizationCode,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: input.redirectUri ?? "",
        grant_type: "authorization_code",
        scope: "offline_access Calendars.ReadWrite",
      }),
    });
    if (!response.ok) throw new Error(`Microsoft OAuth token exchange failed (${response.status})`);
    const token = (await response.json()) as MicrosoftTokenResponse;
    if (!token.refresh_token) throw new Error("Microsoft did not return a refresh_token — request scope=offline_access");
    return { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000, externalCalendarId: null };
  }

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
    const response = await this.fetchImpl(`https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: refreshToken, client_id: this.clientId, client_secret: this.clientSecret, grant_type: "refresh_token", scope: "offline_access Calendars.ReadWrite" }),
    });
    if (!response.ok) throw new Error(`Microsoft OAuth token refresh failed (${response.status})`);
    const token = (await response.json()) as MicrosoftTokenResponse;
    return { accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  }

  private async request<T>(accessToken: string, method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`https://graph.microsoft.com/v1.0${path}`, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`Microsoft Graph API error (${response.status}): ${await response.text().catch(() => "")}`);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private toGraphEvent(input: CalendarEventInput) {
    return {
      subject: input.title,
      body: { contentType: "text", content: input.description },
      start: { dateTime: new Date(input.startsAtMs).toISOString(), timeZone: "UTC" },
      end: { dateTime: new Date(input.endsAtMs).toISOString(), timeZone: "UTC" },
      attendees: [{ emailAddress: { address: input.attendeeEmail, name: input.attendeeName }, type: "required" }],
    };
  }

  async createEvent(accessToken: string, _calendarId: string | null, input: CalendarEventInput): Promise<{ externalEventId: string }> {
    const created = await this.request<MicrosoftEventResponse>(accessToken, "POST", "/me/events", this.toGraphEvent(input));
    return { externalEventId: created.id };
  }

  async updateEvent(accessToken: string, _calendarId: string | null, externalEventId: string, input: CalendarEventInput): Promise<void> {
    await this.request(accessToken, "PATCH", `/me/events/${externalEventId}`, this.toGraphEvent(input));
  }

  async deleteEvent(accessToken: string, _calendarId: string | null, externalEventId: string): Promise<void> {
    await this.request(accessToken, "DELETE", `/me/events/${externalEventId}`);
  }

  async getBusyTimes(accessToken: string, _calendarId: string | null, rangeStartMs: number, rangeEndMs: number): Promise<CalendarBusyBlock[]> {
    const result = await this.request<MicrosoftScheduleResponse>(accessToken, "POST", "/me/calendar/getSchedule", {
      schedules: ["me"],
      startTime: { dateTime: new Date(rangeStartMs).toISOString(), timeZone: "UTC" },
      endTime: { dateTime: new Date(rangeEndMs).toISOString(), timeZone: "UTC" },
    });
    const items = result.value[0]?.scheduleItems ?? [];
    return items.map((item) => ({ startMs: new Date(item.start.dateTime).getTime(), endMs: new Date(item.end.dateTime).getTime() }));
  }
}

/**
 * Real Google only when GOOGLE_CALENDAR_CLIENT_ID/SECRET are explicitly
 * configured, real Microsoft only when MICROSOFT_CALENDAR_CLIENT_ID/SECRET
 * are — unset (the default everywhere, including CI) always returns the
 * fake, same "never by accident" discipline as every sibling factory.
 */
export function createCalendarProvider(provider: "google" | "microsoft", env: NodeJS.ProcessEnv = process.env): CalendarProvider {
  if (provider === "google" && env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET) {
    return new RealGoogleCalendarProvider(env.GOOGLE_CALENDAR_CLIENT_ID, env.GOOGLE_CALENDAR_CLIENT_SECRET);
  }
  if (provider === "microsoft" && env.MICROSOFT_CALENDAR_CLIENT_ID && env.MICROSOFT_CALENDAR_CLIENT_SECRET) {
    return new RealMicrosoftCalendarProvider(env.MICROSOFT_CALENDAR_CLIENT_ID, env.MICROSOFT_CALENDAR_CLIENT_SECRET, env.MICROSOFT_CALENDAR_TENANT);
  }
  return new FakeCalendarProvider();
}
