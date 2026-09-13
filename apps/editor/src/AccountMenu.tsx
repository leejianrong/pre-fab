import { useEffect, useState } from "react";
import { api } from "./api.js";
import { TextButton } from "./ui/index.js";

/**
 * Audit H6: no header user-menu, avatar, or "Log out" existed anywhere in
 * the app — a real gap for a product whose whole pitch is customer
 * ownership, not just a cosmetic one. Deliberately minimal (email + a
 * single button, no dropdown/popover) rather than a `md-menu` anchored
 * popover: the SideSheets (Theme/Bookings/Pages/…) already dim and layer
 * over the canvas, and this needs no more chrome than a plain always-
 * visible pair to satisfy "can a signed-in user find how to sign out."
 */
export function AccountMenu({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAccountMe()
      .then((account) => setEmail(account.email))
      .catch(() => setEmail(null));
  }, []);

  async function logout() {
    // The cookie is httpOnly (can't be cleared from here directly) and the
    // session is revoked server-side too (packages/db's
    // deleteSessionByTokenHash) — either way, once the request settles
    // (success or failure) there's nothing left to do but drop back to the
    // login screen; a network hiccup shouldn't trap someone on this screen
    // unable to leave.
    try {
      await api.logout();
    } finally {
      onLoggedOut();
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      {email ? (
        <span className="pf-supporting-text" style={{ margin: 0 }}>
          {email}
        </span>
      ) : null}
      <TextButton type="button" onClick={logout}>
        Log out
      </TextButton>
    </div>
  );
}
