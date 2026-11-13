// The browser entry point.
import { render } from "./app.ts";
import "./grower.ts";
import "./field.ts";
import "./board.ts";
import "./capacity.ts";
import "./clerk.ts";

window.addEventListener("popstate", () => {
  void render();
});

void render();
