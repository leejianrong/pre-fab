import { describe, expect, it } from "vitest";
import { FakeCalendarProvider } from "../src/lib/calendar-provider.js";

describe("FakeCalendarProvider", () => {
  it("connect() synthesizes a fresh token set with a distinct calendar id every time", async () => {
    const provider = new FakeCalendarProvider();
    const a = await provider.connect({});
    const b = await provider.connect({});
    expect(a.externalCalendarId).not.toBe(b.externalCalendarId);
    expect(a.accessToken).not.toBe(b.accessToken);
  });

  it("createEvent/updateEvent/deleteEvent round-trip against the same calendar id", async () => {
    const provider = new FakeCalendarProvider();
    const { accessToken, externalCalendarId } = await provider.connect({});
    const input = { title: "Booking", description: "", startsAtMs: Date.UTC(2026, 5, 1, 14, 0, 0), endsAtMs: Date.UTC(2026, 5, 1, 14, 30, 0), attendeeEmail: "a@example.com", attendeeName: "A" };

    const created = await provider.createEvent(accessToken, externalCalendarId, input);
    expect(created.externalEventId).toBeTruthy();
    await provider.updateEvent(accessToken, externalCalendarId, created.externalEventId, { ...input, title: "Updated" });
    await provider.deleteEvent(accessToken, externalCalendarId, created.externalEventId);
  });

  it("getBusyTimes returns nothing until setBusyTimes seeds some, filtered to the requested range", async () => {
    const provider = new FakeCalendarProvider();
    const { accessToken, externalCalendarId } = await provider.connect({});
    expect(await provider.getBusyTimes(accessToken, externalCalendarId, 0, 1_000_000)).toEqual([]);

    provider.setBusyTimes(externalCalendarId!, [
      { startMs: 100, endMs: 200 },
      { startMs: 5_000, endMs: 6_000 },
    ]);
    const busy = await provider.getBusyTimes(accessToken, externalCalendarId, 0, 1_000);
    expect(busy).toEqual([{ startMs: 100, endMs: 200 }]);
  });

  it("setUnavailable() simulates a provider outage — every call throws until it's cleared", async () => {
    const provider = new FakeCalendarProvider();
    const { accessToken, externalCalendarId } = await provider.connect({});
    provider.setUnavailable(externalCalendarId!, true);

    await expect(provider.getBusyTimes(accessToken, externalCalendarId, 0, 1000)).rejects.toThrow();
    await expect(
      provider.createEvent(accessToken, externalCalendarId, { title: "x", description: "", startsAtMs: 0, endsAtMs: 1, attendeeEmail: "a@example.com", attendeeName: "A" }),
    ).rejects.toThrow();

    provider.setUnavailable(externalCalendarId!, false);
    await expect(provider.getBusyTimes(accessToken, externalCalendarId, 0, 1000)).resolves.toEqual([]);
  });

  it("refreshAccessToken always succeeds with a fresh token", async () => {
    const provider = new FakeCalendarProvider();
    const refreshed = await provider.refreshAccessToken("any-refresh-token");
    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.expiresAt).toBeGreaterThan(Date.now());
  });
});
