import { createRoot } from "react-dom/client";
import "./styles.css";
import "./lib/motion";
import { App } from "./App";

const faces = ['400 1em "STIX Two Text"', '600 1em "STIX Two Text"'];

void Promise.all(faces.map((face) => document.fonts.load(face)))
  .catch(() => undefined)
  .then(() => {
    const root = document.getElementById("root");
    if (root) createRoot(root).render(<App />);
  });
