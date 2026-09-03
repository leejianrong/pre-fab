import { useState } from "react";
import { api } from "./api.js";
import { FilledButton, TextButton, TextField } from "./ui/index.js";

/**
 * The browser's version of the `dev.login` bootstrap the CLI and the e2e
 * suite use — a seeded-account stand-in for real auth, kept for local dev
 * and tests. `SignupScreen` (linked below) is the real, production path
 * added in Slice 3: a real account, a real emailed verification code.
 */
export function LoginScreen({ onLoggedIn, onSignUp }: { onLoggedIn: () => void; onSignUp: () => void }) {
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
    <div className="pf-centered-page">
      <form onSubmit={submit} className="pf-form">
        <h1 className="pf-headline">pre-fab</h1>
        <TextField label="Seeded account email" value={email} onChange={setEmail} />
        <FilledButton type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </FilledButton>
        {error ? <p className="pf-error-text">{error}</p> : null}
        <TextButton type="button" onClick={onSignUp} style={{ justifySelf: "start" }}>
          First time? Create an account
        </TextButton>
      </form>
    </div>
  );
}
