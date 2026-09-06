import { useEffect, useState } from "react";
import type { FulfillmentType, ProductDocument, ProductStatus } from "@prefab/api-client";
import { api } from "./api.js";
import { Card, FilledButton, SelectField, SideSheet, StatusBadge, TextField } from "./ui/index.js";

interface DraftForm {
  productId: string | null;
  title: string;
  slug: string;
  description: string;
  /** Comma-separated URLs — same convention BlogPanel's `tags` field already uses for a plural, unstructured list. */
  images: string;
  /** Dollars, as typed — converted to cents (ProductDocument.price) only at save time, the same "cents are a storage/API detail, not what an owner types" split Payment/Subscription's own editors would use if they had one. */
  priceDollars: string;
  currency: string;
  fulfillmentType: FulfillmentType;
  /** Empty string when fulfillmentType is digital_or_service (no stock to track) — see ADR-0018. */
  stockCount: string;
  successMessage: string;
  status: ProductStatus;
  expectedVersion: number;
}

function emptyForm(): DraftForm {
  return {
    productId: null,
    title: "",
    slug: "",
    description: "",
    images: "",
    priceDollars: "",
    currency: "usd",
    fulfillmentType: "physical",
    stockCount: "0",
    successMessage: "Thank you for your purchase.",
    status: "draft",
    expectedVersion: 0,
  };
}

function productToForm(product: ProductDocument): DraftForm {
  return {
    productId: product.id,
    title: product.title,
    slug: product.slug,
    description: product.description,
    images: product.images.join(", "),
    priceDollars: (product.price / 100).toFixed(2),
    currency: product.currency,
    fulfillmentType: product.fulfillmentType,
    stockCount: product.stockCount === null ? "" : String(product.stockCount),
    successMessage: product.successMessage,
    status: product.status,
    expectedVersion: product.version,
  };
}

/**
 * KAN-1244's catalogue admin UI — cloned from BlogPanel.tsx's own
 * structure (a form + a list; product.create/product.write already do the
 * real work, this is deliberately not a second place that duplicates their
 * validation). `images` is edited as a comma-separated list of URLs, the
 * same plain-string convention BlogPanel's `tags` field already uses —
 * pasting an uploaded asset's URL here is today's whole "add a product
 * photo" workflow (ADR-0018's own note on why `images` is a bare
 * `string[]`, not a new asset-picker concept).
 */
export function ProductsPanel({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const [products, setProducts] = useState<ProductDocument[] | null>(null);
  const [form, setForm] = useState<DraftForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const result = await api.listProducts(siteId, { limit: 100 });
    setProducts(result.products);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectProduct(product: ProductDocument) {
    setForm(productToForm(product));
    setError(null);
  }

  function startNewProduct() {
    setForm(emptyForm());
    setError(null);
  }

  function setFulfillmentType(fulfillmentType: FulfillmentType) {
    // Switching to digital/service clears stockCount (ADR-0018: it must be
    // null, never a stray number); switching back to physical restores a
    // sensible default rather than leaving it blank.
    setForm({ ...form, fulfillmentType, stockCount: fulfillmentType === "physical" ? form.stockCount || "0" : "" });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const images = form.images
        .split(",")
        .map((src) => src.trim())
        .filter(Boolean);
      const price = Math.round(Number.parseFloat(form.priceDollars || "0") * 100);
      const stockCount = form.fulfillmentType === "physical" ? Number(form.stockCount || "0") : null;

      if (form.productId === null) {
        const created = await api.createProduct(siteId, {
          title: form.title,
          slug: form.slug || undefined,
          description: form.description,
          images,
          price,
          currency: form.currency,
          fulfillmentType: form.fulfillmentType,
          stockCount,
          successMessage: form.successMessage,
          status: form.status,
        });
        setForm(productToForm(created));
      } else {
        const saved = await api.writeProduct(siteId, form.productId, {
          title: form.title,
          slug: form.slug,
          description: form.description,
          images,
          price,
          currency: form.currency,
          fulfillmentType: form.fulfillmentType,
          stockCount,
          successMessage: form.successMessage,
          status: form.status,
          expectedVersion: form.expectedVersion,
        });
        setForm(productToForm(saved));
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SideSheet title="Products" ariaLabel="Catalogue products" closeLabel="Close products panel" onClose={onClose} width={480}>
      {products === null ? (
        <p className="pf-supporting-text">Loading…</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
          {products.map((product) => (
            <li key={product.id}>
              <Card
                interactive
                variant={form.productId === product.id ? "filled" : "outlined"}
                onClick={() => selectProduct(product)}
                style={{ padding: "0.6rem", display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <strong style={{ flex: 1 }}>{product.title}</strong>
                <span className="pf-supporting-text">{(product.price / 100).toFixed(2)} {product.currency.toUpperCase()}</span>
                <StatusBadge tone={product.status === "published" ? "positive" : "neutral"}>{product.status}</StatusBadge>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <FilledButton type="button" onClick={startNewProduct}>
        + New product
      </FilledButton>

      <form onSubmit={save} style={{ display: "grid", gap: "0.75rem" }}>
        <TextField label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} required />
        <TextField
          label="Slug"
          value={form.slug}
          onChange={(v) => setForm({ ...form, slug: v })}
          supportingText="Optional — generated from title if left blank"
        />
        <TextField
          label="Description"
          type="textarea"
          rows={5}
          value={form.description}
          onChange={(v) => setForm({ ...form, description: v })}
          className="pf-mono-field"
        />
        <TextField
          label="Images (comma-separated URLs)"
          value={form.images}
          onChange={(v) => setForm({ ...form, images: v })}
          supportingText="Paste an uploaded asset's URL, or any image URL"
        />
        <TextField
          label="Price (dollars)"
          type="number"
          value={form.priceDollars}
          onChange={(v) => setForm({ ...form, priceDollars: v })}
          required
        />
        <TextField label="Currency" value={form.currency} onChange={(v) => setForm({ ...form, currency: v.toLowerCase() })} />
        <SelectField
          id="product-fulfillment-type"
          label="Fulfillment"
          value={form.fulfillmentType}
          onChange={(v) => setFulfillmentType(v as FulfillmentType)}
        >
          <option value="physical">Physical (ships, tracks stock)</option>
          <option value="digital_or_service">Digital / service (auto-delivered, no stock)</option>
        </SelectField>
        {form.fulfillmentType === "physical" ? (
          <TextField
            label="Stock count"
            type="number"
            value={form.stockCount}
            onChange={(v) => setForm({ ...form, stockCount: v })}
            required
          />
        ) : null}
        <TextField
          label="Post-purchase message"
          type="textarea"
          rows={2}
          value={form.successMessage}
          onChange={(v) => setForm({ ...form, successMessage: v })}
          supportingText="Shown after checkout — the whole fulfillment experience for a digital/service product"
        />
        <SelectField id="product-status" label="Status" value={form.status} onChange={(v) => setForm({ ...form, status: v as ProductStatus })}>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </SelectField>
        <FilledButton type="submit" disabled={saving || form.title.trim() === "" || form.priceDollars.trim() === ""}>
          {saving ? "Saving…" : form.productId === null ? "Create product" : "Save product"}
        </FilledButton>
        {error ? <p className="pf-error-text">{error}</p> : null}
      </form>
    </SideSheet>
  );
}
