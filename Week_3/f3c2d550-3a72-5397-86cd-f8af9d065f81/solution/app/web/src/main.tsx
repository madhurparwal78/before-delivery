import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { DeckProvider } from "./deck";
import { FieldProvider } from "./field";
import { Shell } from "./shell";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <DeckProvider>
        <FieldProvider>
          <Shell />
        </FieldProvider>
      </DeckProvider>
    </BrowserRouter>
  </StrictMode>,
);
