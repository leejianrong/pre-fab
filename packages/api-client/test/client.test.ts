import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiClientError, ApiUnreachableError } from "../src/client.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ApiClient", () => {
  it("sends a Bearer token and no credentials when configured with a token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "site1" }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new ApiClient({ baseUrl: "http://api.local", token: "pf_abc" });
    await client.getSite("site1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.local/v1/sites/site1");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer pf_abc" });
    expect((init as RequestInit).credentials).toBe("omit");
  });

  it("uses cookie credentials when no token is configured (the editor's case)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new ApiClient({ baseUrl: "http://api.local" });
    await client.listSites();

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).credentials).toBe("include");
    expect((init as RequestInit).headers).not.toHaveProperty("authorization");
  });

  it("maps a non-ok JSON error response to a typed ApiClientError with its code intact", async () => {
    const errorBody = { error: { code: "conflict", message: "stale version", details: { current: {}, diff: {} } } };
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(errorBody), { status: 409 })) as unknown as typeof fetch;

    const client = new ApiClient({ baseUrl: "http://api.local", token: "t" });

    await expect(client.getSite("x")).rejects.toMatchObject({ code: "conflict", status: 409 });
    try {
      await client.getSite("x");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
      expect((error as ApiClientError).asConflict()).toMatchObject({ current: {}, diff: {} });
    }
  });

  it("wraps a network failure as ApiUnreachableError rather than letting it throw raw", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const client = new ApiClient({ baseUrl: "http://api.local", token: "t" });
    await expect(client.getSite("x")).rejects.toBeInstanceOf(ApiUnreachableError);
  });
});
