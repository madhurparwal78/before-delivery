import { installFocusRule } from "./focus.js";
import { Menu } from "./menu.js";
import { Router } from "./router.js";
import type { Bootstrap } from "../shared/types.js";

function readBootstrap(): Bootstrap {
  const script = document.getElementById("bootstrap");
  if (script === null) throw new Error("Bootstrap data missing");
  return JSON.parse(script.textContent ?? "") as Bootstrap;
}

const main = document.querySelector("main");
if (main === null) throw new Error("Main landmark missing");

document.addEventListener(
  "error",
  (event) => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.classList.contains("media-img")) image.closest(".media-frame")?.classList.add("failed");
  },
  true,
);

installFocusRule();
new Router(readBootstrap(), main, new Menu()).start();
