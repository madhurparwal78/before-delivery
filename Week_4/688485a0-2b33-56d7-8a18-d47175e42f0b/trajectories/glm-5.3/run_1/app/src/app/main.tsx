import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource/tiktok-sans/400.css";
import "@fontsource/tiktok-sans/700.css";
import "@fontsource/tiktok-sans/800.css";
import "@fontsource/tiktok-sans/900.css";
import "@fontsource/martian-mono/400.css";
import "@fontsource/martian-mono/700.css";
import "./main.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
