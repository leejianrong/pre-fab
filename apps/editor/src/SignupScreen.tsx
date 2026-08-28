import { useState } from "react";
import { api } from "./api.js";

type Step = { kind: "email" } | { kind: "code"; email: string };

/**
 * Real signup (Slice 3): an email, a 6-digit code, done. No password — this
 * fits ADR-0001's non-technical beachhead better than a password-reset
 * flow, and it's built on the exact same accounts/sessions tables
 * `dev.login` already uses (SLICES.md: "built on slice 1's identity
 * primitive rather than replacing it").
 */
export function SignupScreen({ onSignedUp, onBackToLogin }: { onSignedUp: () => void; onBackToLogin: () => void }) {
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.signup(email);
      setStep({ kind: "code", email });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (step.kind !== "code") return;
    setPending(true);
    setError(null);
    try {
      await api.verifyEmail(step.email, code);
      onSignedUp();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh", fontFamily: "system-ui, sans-serif" }}>
      {step.kind === "email" ? (
        <form onSubmit={submitEmail} style={{ display: "grid", gap: "0.75rem", width: 320 }}>
          <h1 style={{ fontSize: "1.25rem", margin: 0 }}>Create your account</h1>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "#64748b" }}>We'll email you a 6-digit code — no password to remember.</p>
          <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.875rem" }}>
            Email address
            <input
              type="email"
              required
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
            {pending ? "Sending code…" : "Send me a code"}
          </button>
          {error ? <p style={{ color: "#dc2626", fontSize: "0.875rem" }}>{error}</p> : null}
          <button
            type="button"
            onClick={onBackToLogin}
            style={{ background: "none", border: "none", color: "#4f46e5", cursor: "pointer", fontSize: "0.875rem", padding: 0, justifySelf: "start" }}
          >
            Already have an account? Sign in
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode} style={{ display: "grid", gap: "0.75rem", width: 320 }}>
          <h1 style={{ fontSize: "1.25rem", margin: 0 }}>Check your email</h1>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "#64748b" }}>
            We sent a 6-digit code to <strong>{step.email}</strong>.
          </p>
          <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.875rem" }}>
            Verification code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              inputMode="numeric"
              style={{ padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: "0.375rem", letterSpacing: "0.25rem", fontSize: "1.125rem" }}
            />
          </label>
          <button
            type="submit"
            disabled={pending || code.length !== 6}
            style={{ padding: "0.5rem", background: "#4f46e5", color: "white", border: "none", borderRadius: "0.375rem" }}
          >
            {pending ? "Verifying…" : "Verify and continue"}
          </button>
          {error ? <p style={{ color: "#dc2626", fontSize: "0.875rem" }}>{error}</p> : null}
        </form>
      )}
    </div>
  );
}
