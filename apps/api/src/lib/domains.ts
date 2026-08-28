/**
 * Pure DNS/hostname logic (SLICES.md Slice 4: "DNS record validation and
 * normalisation" / "apex-versus-subdomain detection") — no network, no
 * database, fully unit-testable. Kept separate from lib/domain-provider.ts
 * (which talks to Cloudflare or the fake) so the two can be tested
 * independently.
 */

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

/**
 * Second-level suffixes under which a domain is still one label "deeper"
 * than usual before it stops being an apex (e.g. "example.co.uk" is an
 * apex domain, not a subdomain of "co.uk"). This is a small, hand-picked
 * list, not a full Public Suffix List — real registrable-domain detection
 * needs the IANA PSL (hundreds of entries, changes over time), which is
 * out of scope here. Anything not in this list falls back to the common
 * case (a two-label TLD like ".com"/".dev"/".io"), which is correct for
 * the large majority of domains a small business would actually use.
 */
const COMPOUND_SECOND_LEVEL_TLDS = new Set([
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "me.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.jp",
  "co.in",
  "com.br",
]);

const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_HOSTNAME_LENGTH = 253;

/**
 * Trims, lowercases, and strips whatever a non-technical owner might
 * plausibly paste in — a scheme, a path, a port, a trailing dot — down to
 * a bare hostname. Does not validate; call `validateHostname` after.
 */
export function normalizeHostname(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^[a-z]+:\/\//, "");
  value = value.split("/")[0] ?? value;
  value = value.split("?")[0] ?? value;
  if (!value.includes("[")) {
    // Only strip a :port suffix for a plain hostname — an IPv6 literal
    // (which validateHostname rejects outright anyway) uses colons for
    // its address, not a port delimiter.
    value = value.split(":")[0] ?? value;
  }
  value = value.replace(/\.$/, "");
  return value;
}

export interface DomainClassification {
  hostname: string;
  isApex: boolean;
  /** The registrable domain (e.g. "example.co.uk" for "shop.example.co.uk") — the unit DNS/certificate authorities reason about. */
  registrableDomain: string;
}

/**
 * Validates a normalized hostname and classifies it apex-vs-subdomain in
 * one pass, since both need the same label split and the same rejection
 * conditions (empty, wildcard, IP literal, the platform's own domain).
 */
export function classifyDomain(hostname: string, platformHost: string): DomainClassification {
  if (hostname.length === 0) {
    throw new DomainValidationError("enter a domain");
  }
  if (hostname.length > MAX_HOSTNAME_LENGTH) {
    throw new DomainValidationError(`"${hostname}" is too long to be a valid domain`);
  }
  if (hostname.startsWith("*.")) {
    throw new DomainValidationError("wildcard domains (e.g. *.example.com) aren't supported — add each domain individually");
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) {
    throw new DomainValidationError(`"${hostname}" looks like an IP address, not a domain name`);
  }

  const labels = hostname.split(".");
  if (labels.length < 2 || labels.some((label) => !LABEL_PATTERN.test(label))) {
    throw new DomainValidationError(`"${hostname}" is not a valid domain name`);
  }

  if (hostname === platformHost || hostname.endsWith(`.${platformHost}`)) {
    throw new DomainValidationError(`"${hostname}" is a pre-fab-hosted address, not a domain you can bring — every site already gets a free one`);
  }

  const lastTwo = labels.slice(-2).join(".");
  const registrableLabelCount = COMPOUND_SECOND_LEVEL_TLDS.has(lastTwo) ? 3 : 2;
  if (labels.length < registrableLabelCount) {
    throw new DomainValidationError(`"${hostname}" is not a valid domain name`);
  }
  const registrableDomain = labels.slice(-registrableLabelCount).join(".");
  const isApex = labels.length === registrableLabelCount;

  return { hostname, isApex, registrableDomain };
}

export interface DnsInstruction {
  recordType: "CNAME" | "ALIAS/ANAME";
  name: string;
  value: string;
  note: string;
}

/**
 * SLICES.md: "Apex and `www` handling." A subdomain (the common case —
 * `www`, `app`, anything with a label before the registrable domain) gets
 * a plain CNAME. An apex/root domain (`example.com` itself) cannot use a
 * CNAME per the DNS spec — it needs an ALIAS/ANAME record (most modern
 * registrars and DNS hosts support one under some name), or the owner's
 * nameservers delegated to Cloudflare so Cloudflare can flatten a CNAME at
 * the apex automatically. Both are named here rather than silently only
 * supporting one, since which option is available depends on the owner's
 * registrar and is exactly the kind of detail a non-technical owner needs
 * spelled out (SLICES.md: "a DNS walkthrough that a non-technical owner
 * can follow").
 */
export function dnsInstructionFor(classification: DomainClassification, cnameTarget: string): DnsInstruction {
  if (classification.isApex) {
    return {
      recordType: "ALIAS/ANAME",
      name: "@",
      value: cnameTarget,
      note:
        "Root domains can't use a CNAME record. Add an ALIAS or ANAME record instead if your DNS provider offers one " +
        `(most do, sometimes under a different name), pointing "@" at ${cnameTarget}. If your provider doesn't support ` +
        `ALIAS/ANAME, use a subdomain like "www.${classification.registrableDomain}" instead, or point this domain's ` +
        "nameservers at Cloudflare.",
    };
  }
  // Not apex (handled above), so hostname is strictly deeper than its
  // registrable domain — the CNAME's record name is everything before it.
  const name = classification.hostname.slice(0, -(classification.registrableDomain.length + 1));
  return {
    recordType: "CNAME",
    name,
    value: cnameTarget,
    note: `Add a CNAME record for "${name}" pointing at ${cnameTarget}.`,
  };
}
