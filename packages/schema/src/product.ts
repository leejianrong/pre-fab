import { z } from "zod";
import { UlidSchema } from "./ids.js";

/** The product document envelope's own format version — independent of any block's schemaVersion (there are no blocks here). */
export const PRODUCT_DOCUMENT_SCHEMA_VERSION = 1;

export const ProductStatusSchema = z.enum(["draft", "published"]);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

/** ADR-0018 question 2: designed in from this card, not card 3, because it changes what `stockCount` means. */
export const FulfillmentTypeSchema = z.enum(["physical", "digital_or_service"]);
export type FulfillmentType = z.infer<typeof FulfillmentTypeSchema>;

/**
 * A catalogue product (KAN-1244 / ADR-0018): owner-authored content, its
 * own collection (not a `post` with e-commerce fields bolted on — see the
 * ADR's question 1), with the same optimistic-concurrency version
 * (ADR-0006/R17) every other mutation gets.
 *
 * Single-SKU only for milestone 3 (ADR-0018 question 3) — one `price`, one
 * `stockCount`, no variants.
 *
 * `fulfillmentType` decides what `stockCount` means: `"physical"` requires
 * a real, non-negative inventory count; `"digital_or_service"` requires
 * `stockCount` to be `null` (nothing to run out of, auto-delivered on
 * payment). `validateProductDocument` enforces this pairing — see its own
 * comment and ADR-0018 question 2 for why this isn't just a looser
 * `.nullable()` with no cross-field rule.
 */
export const ProductDocumentSchema = z.object({
  id: UlidSchema,
  siteId: UlidSchema,
  slug: z.string().min(1),
  title: z.string().min(1),
  schemaVersion: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  description: z.string().default(""),
  /** Plain URL strings — same "no separate asset-reference concept" convention `image`/`gallery` block schemas already use, populated by copying an uploaded asset's URL (sha256 content-addressed, apps/api's asset-storage.ts). */
  images: z.array(z.string().max(2048)).max(12).default([]),
  /** Cents — never a whole-currency-unit float, same reasoning as `PaymentPropsSchema.amount`. Server-resolved once checkout (card 2) exists; never trusted from a visitor's own request. */
  price: z.number().int().positive().max(99_999_999),
  /** Lowercase ISO 4217, e.g. "usd", "eur", "gbp". */
  currency: z
    .string()
    .regex(/^[a-z]{3}$/, "must be a lowercase 3-letter ISO 4217 currency code")
    .default("usd"),
  fulfillmentType: FulfillmentTypeSchema.default("physical"),
  /** Required (non-negative integer) when physical; required `null` when digital/service — see validateProductDocument. */
  stockCount: z.number().int().nonnegative().nullable().default(0),
  /** Shown after checkout (card 2) — the entire fulfillment experience for a digital/service product, an optional thank-you for a physical one. See ADR-0018 question 2. */
  successMessage: z.string().max(300).default("Thank you for your purchase."),
  status: ProductStatusSchema.default("draft"),
});

export type ProductDocument = z.infer<typeof ProductDocumentSchema>;

export function createEmptyProduct(input: {
  id: string;
  siteId: string;
  slug: string;
  title: string;
  price: number;
  fulfillmentType?: FulfillmentType;
}): ProductDocument {
  const fulfillmentType = input.fulfillmentType ?? "physical";
  return {
    id: input.id,
    siteId: input.siteId,
    slug: input.slug,
    title: input.title,
    schemaVersion: PRODUCT_DOCUMENT_SCHEMA_VERSION,
    version: 0,
    description: "",
    images: [],
    price: input.price,
    currency: "usd",
    fulfillmentType,
    stockCount: fulfillmentType === "physical" ? 0 : null,
    successMessage: "Thank you for your purchase.",
    status: "draft",
  };
}

/**
 * A product is publicly reachable only once published — unlike a post,
 * there is no date/scheduling gate (ADR-0018 question 1: a shop doesn't
 * schedule a product for a future calendar date the way a blog schedules a
 * post). Callers filter with this *before* handing products to the publish
 * pipeline (@prefab/publish never re-derives visibility itself), mirroring
 * isPostVisible's own contract.
 */
export function isProductVisible(product: Pick<ProductDocument, "status">): boolean {
  return product.status === "published";
}

export interface ProductValidationIssue {
  path: (string | number)[];
  message: string;
}

export type ProductValidationResult =
  | { ok: true; issues: []; document: ProductDocument }
  | { ok: false; issues: ProductValidationIssue[]; document?: undefined };

/**
 * Whole-document validation, same "reject wholesale, name every problem"
 * discipline as validatePostDocument — plus the one cross-field rule this
 * collection has that posts don't: `stockCount`'s meaning is conditional on
 * `fulfillmentType` (ADR-0018 question 2), so a plain per-field zod schema
 * can't fully describe it on its own.
 */
export function validateProductDocument(input: unknown): ProductValidationResult {
  const result = ProductDocumentSchema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
        message: issue.message,
      })),
    };
  }

  const document = result.data;
  const issues: ProductValidationIssue[] = [];
  if (document.fulfillmentType === "physical" && document.stockCount === null) {
    issues.push({ path: ["stockCount"], message: "stockCount is required (a non-negative integer) for a physical product" });
  }
  if (document.fulfillmentType === "digital_or_service" && document.stockCount !== null) {
    issues.push({
      path: ["stockCount"],
      message: "stockCount must be null for a digital/service product — it is auto-delivered, with no stock to track",
    });
  }
  if (issues.length > 0) return { ok: false, issues };

  return { ok: true, issues: [], document };
}
