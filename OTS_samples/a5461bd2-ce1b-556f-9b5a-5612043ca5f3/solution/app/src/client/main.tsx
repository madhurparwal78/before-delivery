import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import "./styles.css";
import { App } from "./app";
import { guardKeyboardFocus } from "./focus";
import { getLocation, routeOf } from "./router";
import { stage } from "./stage/controller";

const root = document.getElementById("root");
if (!root) throw new Error("the page has no root element");

stage.start(routeOf(getLocation()));
flushSync(() => createRoot(root).render(<App />));
guardKeyboardFocus();
