import { useState } from "react";
import { api } from "./api.js";

/**
 * Slice 1 has no signup UI (SLICES.md) — accounts are seeded, and this is
 * the browser's version of the same `dev.login` bootstrap the CLI and the
 * e2e suite use. Slice 3 replaces this with real signup.
 */
export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("owner@example.com");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.devLogin(email);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <form onSubmit={submit} style={{ display: "grid", gap: "0.75rem", width: 320 }}>
        <h1 style={{ fontSize: "1.25rem", margin: 0 }}>pre-fab</h1>
        <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.875rem" }}>
          Seeded account email
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: "0.375rem" }}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          style={{ padding: "0.5rem", background: "#4f46e5", color: "white", border: "none", borderRadius: "0.375rem" }}
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
        {error ? <p style={{ color: "#dc2626", fontSize: "0.875rem" }}>{error}</p> : null}
      </form>
    </div>
  );
}
