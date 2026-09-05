import { useState } from "react";
import { api } from "./api.js";
import { FilledButton, TextButton, TextField } from "./ui/index.js";

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
    <div className="pf-centered-page">
      {step.kind === "email" ? (
        <form onSubmit={submitEmail} className="pf-form">
          <h1 className="pf-headline">Create your account</h1>
          <p className="pf-supporting-text">We'll email you a 6-digit code — no password to remember.</p>
          <TextField label="Email address" type="email" required value={email} onChange={setEmail} />
          <FilledButton type="submit" disabled={pending}>
            {pending ? "Sending code…" : "Send me a code"}
          </FilledButton>
          {error ? <p className="pf-error-text">{error}</p> : null}
          <TextButton type="button" onClick={onBackToLogin} style={{ justifySelf: "start" }}>
            Already have an account? Sign in
          </TextButton>
        </form>
      ) : (
        <form onSubmit={submitCode} className="pf-form">
          <h1 className="pf-headline">Check your email</h1>
          <p className="pf-supporting-text">
            We sent a 6-digit code to <strong>{step.email}</strong>.
          </p>
          <TextField
            label="Verification code"
            value={code}
            onChange={setCode}
            maxLength={6}
            inputMode="numeric"
            style={{ letterSpacing: "0.25rem", fontSize: "1.125rem" }}
          />
          <FilledButton type="submit" disabled={pending || code.length !== 6}>
            {pending ? "Verifying…" : "Verify and continue"}
          </FilledButton>
          {error ? <p className="pf-error-text">{error}</p> : null}
        </form>
      )}
    </div>
  );
}
