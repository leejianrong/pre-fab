import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@puckeditor/core/puck.css";
import "./ui/register.js";
import "./ui/tokens.css";
import { injectMaterialTheme } from "./ui/theme.js";
import { App } from "./App.js";

injectMaterialTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
