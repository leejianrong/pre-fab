import { useCallback, useEffect, useState } from "react";

/**
 * KAN-1245 / ADR-0018 cart addendum: cart state is stateless and
 * client-side only (localStorage) — no visitor-session or cart-persistence
 * table, already settled with the user. Shared by ProductDetail's
 * add-to-cart button and CartDrawer's mini-cart, two independently
 * hydrated islands (@prefab/publish's page-template.ts) with no shared
 * React tree to lift state into — they only ever agree with each other
 * through this one localStorage key plus a same-page `CustomEvent`.
 *
 * Every `window`/`localStorage` reference below sits lexically inside a
 * `useEffect` call — never at module or render scope (ADR-0004 / CLAUDE.md
 * invariant 3). This is stricter than it sounds: tools/checks' ssr-safety
 * scan (checkSsrSafety) is a per-file, purely lexical AST walk — it marks a
 * reference "inside an effect" only while literally recursing through a
 * `useEffect(() => {...})` call's own argument, with no awareness of which
 * function calls which at runtime. A helper declared at this file's top
 * level that touched `window.localStorage` would fail the scan even if
 * every call to it happened to originate from inside an effect — so the
 * only top-level helpers here (`parseCartItems`, `cartItemsEqual`) are pure
 * and never reference a browser global; the two effects below inline every
 * actual `window`/`localStorage` call themselves.
 */
export const CART_STORAGE_KEY = "pf:cart:v1";
export const CART_EVENT_NAME = "pf:cart:changed";

/** Denormalized at add-to-cart time, for the mini-cart's own display only. `createCartCheckout` (@prefab/runtime) never trusts any of this for money — it always re-resolves price/currency/stock from the CURRENT `products` row at checkout time; only `productId`/`quantity` from this record ever leave the browser. */
export interface CartItem {
  productId: string;
  quantity: number;
  title: string;
  /** Cents — display only. */
  price: number;
  currency: string;
  image: string | null;
  fulfillmentType: "physical" | "digital_or_service";
}

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.productId === "string" &&
    v.productId.length > 0 &&
    typeof v.quantity === "number" &&
    Number.isInteger(v.quantity) &&
    v.quantity > 0 &&
    typeof v.title === "string" &&
    typeof v.price === "number" &&
    typeof v.currency === "string" &&
    (v.image === null || typeof v.image === "string") &&
    (v.fulfillmentType === "physical" || v.fulfillmentType === "digital_or_service")
  );
}

/** Pure — no browser global reference, safe at module scope (see this file's own module comment). */
function parseCartItems(raw: string | null): CartItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isCartItem) : [];
  } catch {
    return [];
  }
}

/** Pure — used to bail a `setState` update out as a no-op when a reload produces content identical to what's already in state, which is what stops the write-effect/listen-effect pair below from dispatching a change event forever in a loop (each write's own dispatch is also heard by this same hook's own listener). */
function cartItemsEqual(a: CartItem[], b: CartItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return (
      !!other &&
      item.productId === other.productId &&
      item.quantity === other.quantity &&
      item.title === other.title &&
      item.price === other.price &&
      item.currency === other.currency &&
      item.image === other.image &&
      item.fulfillmentType === other.fulfillmentType
    );
  });
}

export interface UseCartResult {
  items: CartItem[];
  /** False until the initial localStorage read completes (client-only, so this is always false during SSR/the very first client render) — lets a caller avoid flashing an empty cart before hydration. */
  ready: boolean;
  totalQuantity: number;
  /** Merges into an existing line (quantities summed) if `item.productId` is already in the cart — mirrors createCartCheckout's own duplicate-merging on the server. */
  addItem: (item: Omit<CartItem, "quantity">, quantity: number) => void;
  /** `quantity <= 0` removes the line. */
  setQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
}

export function useCart(): UseCartResult {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  // Hydrate from localStorage once on mount, and stay in sync with other
  // islands on the same page (a same-page CustomEvent, since a "storage"
  // event only ever fires for OTHER documents/tabs, never this one) and
  // with other tabs/documents at the same origin (a real "storage" event).
  useEffect(() => {
    function load() {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      const next = parseCartItems(raw);
      setItems((prev) => (cartItemsEqual(prev, next) ? prev : next));
    }
    load();
    setReady(true);

    function onExternalChange() {
      load();
    }
    window.addEventListener(CART_EVENT_NAME, onExternalChange);
    window.addEventListener("storage", onExternalChange);
    return () => {
      window.removeEventListener(CART_EVENT_NAME, onExternalChange);
      window.removeEventListener("storage", onExternalChange);
    };
  }, []);

  // Persist every change back to localStorage and notify other islands on
  // the same page. Gated on `ready` so this never fires before the
  // hydration effect above has had its first chance to run (which would
  // otherwise overwrite an existing cart with the empty initial state).
  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(CART_EVENT_NAME));
  }, [items, ready]);

  const addItem = useCallback((item: Omit<CartItem, "quantity">, quantity: number) => {
    if (!Number.isInteger(quantity) || quantity <= 0) return;
    setItems((current) => {
      const existing = current.find((line) => line.productId === item.productId);
      if (existing) {
        return current.map((line) => (line.productId === item.productId ? { ...line, ...item, quantity: line.quantity + quantity } : line));
      }
      return [...current, { ...item, quantity }];
    });
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setItems((current) => {
      if (quantity <= 0) return current.filter((line) => line.productId !== productId);
      return current.map((line) => (line.productId === productId ? { ...line, quantity } : line));
    });
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((current) => current.filter((line) => line.productId !== productId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return { items, ready, totalQuantity, addItem, setQuantity, removeItem, clear };
}
