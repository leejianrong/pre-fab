import { describe, expect, it } from "vitest";
import { FakeDomainProvider } from "../src/lib/domain-provider.js";

describe("FakeDomainProvider", () => {
  it("starts a new hostname pending", async () => {
    const provider = new FakeDomainProvider();
    const created = await provider.createCustomHostname("example.com");
    expect(created.status).toBe("pending");
    expect(created.verificationErrors).toEqual([]);

    const fetched = await provider.getCustomHostnameStatus(created.providerHostnameId);
    expect(fetched.status).toBe("pending");
  });

  it("advance() simulates DNS propagation completing, and repeated polls stay stable (the 'renewal path' shape)", async () => {
    const provider = new FakeDomainProvider();
    const { providerHostnameId } = await provider.createCustomHostname("example.com");

    provider.advance(providerHostnameId, "active");
    const first = await provider.getCustomHostnameStatus(providerHostnameId);
    const second = await provider.getCustomHostnameStatus(providerHostnameId);
    expect(first.status).toBe("active");
    expect(second.status).toBe("active");
  });

  it("advance() can simulate a failed verification with a specific error", async () => {
    const provider = new FakeDomainProvider();
    const { providerHostnameId } = await provider.createCustomHostname("example.com");

    provider.advance(providerHostnameId, "failed", ["CNAME record not found"]);
    const fetched = await provider.getCustomHostnameStatus(providerHostnameId);
    expect(fetched.status).toBe("failed");
    expect(fetched.verificationErrors).toEqual(["CNAME record not found"]);
  });

  it("deleteCustomHostname removes the hostname — a later status check fails", async () => {
    const provider = new FakeDomainProvider();
    const { providerHostnameId } = await provider.createCustomHostname("example.com");
    await provider.deleteCustomHostname(providerHostnameId);
    await expect(provider.getCustomHostnameStatus(providerHostnameId)).rejects.toThrow();
  });

  it("rejects operations on an unknown hostname id", async () => {
    const provider = new FakeDomainProvider();
    await expect(provider.getCustomHostnameStatus("fake_doesnotexist")).rejects.toThrow();
    expect(() => provider.advance("fake_doesnotexist", "active")).toThrow();
  });
});
