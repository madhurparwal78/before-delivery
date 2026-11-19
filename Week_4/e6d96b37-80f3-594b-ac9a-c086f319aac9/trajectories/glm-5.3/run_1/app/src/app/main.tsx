import React from "react";
import { createRoot } from "react-dom/client";
import "./desk.css";
import { App } from "./app.js";

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(<App />);
