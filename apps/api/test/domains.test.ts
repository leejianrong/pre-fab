import { describe, expect, it } from "vitest";
import { classifyDomain, dnsInstructionFor, DomainValidationError, normalizeHostname } from "../src/lib/domains.js";

const PLATFORM_HOST = "prefab.app";

describe("normalizeHostname", () => {
  it("lowercases and trims", () => {
    expect(normalizeHostname("  Example.COM  ")).toBe("example.com");
  });

  it("strips a scheme, path and trailing dot a non-technical owner might paste", () => {
    expect(normalizeHostname("https://www.example.com/some/page")).toBe("www.example.com");
    expect(normalizeHostname("example.com.")).toBe("example.com");
  });

  it("strips a port but leaves an IPv6-looking literal alone for validation to reject", () => {
    expect(normalizeHostname("example.com:8080")).toBe("example.com");
  });
});

describe("classifyDomain (apex vs. subdomain, R1/SLICES.md)", () => {
  it("classifies a bare two-label domain as apex", () => {
    const result = classifyDomain("example.com", PLATFORM_HOST);
    expect(result.isApex).toBe(true);
    expect(result.registrableDomain).toBe("example.com");
  });

  it("classifies a www/app subdomain as not-apex", () => {
    const result = classifyDomain("www.example.com", PLATFORM_HOST);
    expect(result.isApex).toBe(false);
    expect(result.registrableDomain).toBe("example.com");
  });

  it("handles a compound second-level TLD (example.co.uk is apex, not a subdomain of co.uk)", () => {
    const apex = classifyDomain("example.co.uk", PLATFORM_HOST);
    expect(apex.isApex).toBe(true);
    expect(apex.registrableDomain).toBe("example.co.uk");

    const sub = classifyDomain("shop.example.co.uk", PLATFORM_HOST);
    expect(sub.isApex).toBe(false);
    expect(sub.registrableDomain).toBe("example.co.uk");
  });

  it("rejects an empty hostname", () => {
    expect(() => classifyDomain("", PLATFORM_HOST)).toThrow(DomainValidationError);
  });

  it("rejects a single-label input (no TLD)", () => {
    expect(() => classifyDomain("localhost", PLATFORM_HOST)).toThrow(DomainValidationError);
  });

  it("rejects a wildcard domain", () => {
    expect(() => classifyDomain("*.example.com", PLATFORM_HOST)).toThrow(DomainValidationError);
  });

  it("rejects an IPv4 literal", () => {
    expect(() => classifyDomain("192.168.1.1", PLATFORM_HOST)).toThrow(DomainValidationError);
  });

  it("rejects a domain with an invalid label", () => {
    expect(() => classifyDomain("-bad.example.com", PLATFORM_HOST)).toThrow(DomainValidationError);
    expect(() => classifyDomain("bad-.example.com", PLATFORM_HOST)).toThrow(DomainValidationError);
  });

  it("rejects the platform's own hosting domain and any subdomain of it", () => {
    expect(() => classifyDomain("prefab.app", PLATFORM_HOST)).toThrow(DomainValidationError);
    expect(() => classifyDomain("myslug.prefab.app", PLATFORM_HOST)).toThrow(DomainValidationError);
  });
});

describe("dnsInstructionFor (apex/www handling, SLICES.md)", () => {
  it("gives a plain CNAME for a subdomain", () => {
    const classification = classifyDomain("www.example.com", PLATFORM_HOST);
    const instruction = dnsInstructionFor(classification, "customer-domains.prefab.app");
    expect(instruction.recordType).toBe("CNAME");
    expect(instruction.name).toBe("www");
    expect(instruction.value).toBe("customer-domains.prefab.app");
  });

  it("gives a deeper subdomain's correct record name", () => {
    const classification = classifyDomain("shop.example.co.uk", PLATFORM_HOST);
    const instruction = dnsInstructionFor(classification, "customer-domains.prefab.app");
    expect(instruction.name).toBe("shop");
  });

  it("gives ALIAS/ANAME guidance for an apex domain, explaining the CNAME limitation", () => {
    const classification = classifyDomain("example.com", PLATFORM_HOST);
    const instruction = dnsInstructionFor(classification, "customer-domains.prefab.app");
    expect(instruction.recordType).toBe("ALIAS/ANAME");
    expect(instruction.name).toBe("@");
    expect(instruction.note.toLowerCase()).toContain("root domain");
    expect(instruction.note.toLowerCase()).toMatch(/can't use a cname|cannot use a cname/);
  });
});
