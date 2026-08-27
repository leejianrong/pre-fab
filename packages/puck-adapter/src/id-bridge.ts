import { isUlid, newUlid, type Ulid } from "@prefab/schema";

/**
 * The spike's second finding (ADR-0004): Puck's own `Data.content[].props.id`
 * is *not* our ULID by default. When the editor hydrates from our document,
 * we hand Puck our ULID as its `id` and it keeps using that string for the
 * life of the session — no translation needed. But when a component is
 * created inside the canvas (dragged from the drawer), Puck mints its own
 * id via internal `generateId()` (`"<type>-<uuid>"`) that we do not control
 * and cannot intercept before the fact.
 *
 * Rather than fight that, this bridge remaps it once: the first time a
 * non-ULID id is seen, mint a ULID and cache the pair for the rest of the
 * browser session, so every later read of that same (stable, Puck-owned)
 * raw id resolves to the same ULID. On the next full reload the document
 * comes back from the API with real ULIDs already in place, so the cache
 * starts empty and is only ever needed for genuinely new components.
 */
export class PuckIdBridge {
  private readonly rawToUlid = new Map<string, Ulid>();

  resolve(rawId: string): Ulid {
    if (isUlid(rawId)) return rawId;
    const cached = this.rawToUlid.get(rawId);
    if (cached) return cached;
    const minted = newUlid();
    this.rawToUlid.set(rawId, minted);
    return minted;
  }
}
