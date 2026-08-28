import { useEffect, useState } from "react";
import { ApiClientError } from "@prefab/api-client";
import { LoginScreen } from "./LoginScreen.js";
import { SignupScreen } from "./SignupScreen.js";
import { SitePicker } from "./SitePicker.js";
import { SiteEditor } from "./SiteEditor.js";
import { api } from "./api.js";

type Screen =
  | { kind: "checking" }
  | { kind: "login" }
  | { kind: "signup" }
  | { kind: "picker" }
  | { kind: "editor"; siteId: string; firstRun?: boolean };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "checking" });

  useEffect(() => {
    api
      .listSites()
      .then(() => setScreen({ kind: "picker" }))
      .catch((err) => {
        if (err instanceof ApiClientError && (err.code === "unauthorized" || err.code === "forbidden")) {
          setScreen({ kind: "login" });
        } else {
          setScreen({ kind: "login" });
        }
      });
  }, []);

  if (screen.kind === "checking") return null;
  if (screen.kind === "login") {
    return <LoginScreen onLoggedIn={() => setScreen({ kind: "picker" })} onSignUp={() => setScreen({ kind: "signup" })} />;
  }
  if (screen.kind === "signup") {
    return <SignupScreen onSignedUp={() => setScreen({ kind: "picker" })} onBackToLogin={() => setScreen({ kind: "login" })} />;
  }
  if (screen.kind === "picker") {
    return <SitePicker onSiteSelected={(siteId, opts) => setScreen({ kind: "editor", siteId, firstRun: opts?.firstRun })} />;
  }
  return (
    <SiteEditor
      siteId={screen.siteId}
      firstRun={screen.firstRun}
      onBack={() => setScreen({ kind: "picker" })}
    />
  );
}
