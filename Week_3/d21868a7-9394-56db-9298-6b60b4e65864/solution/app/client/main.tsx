import "./fonts/fonts.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

// The bundled faces are preloaded; mounting once they are in keeps the first screen from shifting when they swap in.
const faces = ["700 1em Archivo", "800 1em Archivo", "400 1em 'IBM Plex Sans'", "500 1em 'IBM Plex Sans'", "600 1em 'IBM Plex Sans'"];

Promise.allSettled(faces.map((face) => document.fonts.load(face))).then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
