import "./styles.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { ReviewPage } from "./review";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <ReviewPage />
    </React.StrictMode>,
  );
}
