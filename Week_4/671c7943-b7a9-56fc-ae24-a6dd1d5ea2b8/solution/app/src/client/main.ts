import { must } from "./dom.js";
import { updateScrollEffects } from "./effects.js";
import { keepFocusClear, jumpTo } from "./jump.js";
import { initMenu } from "./menu.js";
import { handleLink, initRouter } from "./router.js";
import { onScroll, runScrollListeners, startScrollListeners } from "./scroll.js";

initMenu(handleLink, runScrollListeners);
keepFocusClear();
onScroll(updateScrollEffects);

must<HTMLAnchorElement>(document, "[data-skip]").addEventListener("click", (event) => {
  event.preventDefault();
  must<HTMLElement>(document, "main h1").focus();
});

initRouter();
startScrollListeners();

function jumpToHash(): void {
  const id = location.hash.slice(1);
  const heading = id === "" ? null : document.getElementById(`${id}-title`);
  const service = new URL(location.href).searchParams.get("service");
  if (heading && service === null) jumpTo(heading, true);
}

jumpToHash();
runScrollListeners();
addEventListener("load", () => {
  jumpToHash();
  runScrollListeners();
});
