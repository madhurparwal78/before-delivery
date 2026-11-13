import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./app";

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <StrictMode>
    <AppShell />
  </StrictMode>
);
