// The 404 page (the server answers 404 for any unknown address).
import { h } from "../dom.ts";
import type { PageContext } from "../router.ts";
import { pageHead } from "../ui.ts";

export function notFound({ main }: PageContext): void {
  document.title = "Page not found | Tern Foils";
  main.append(pageHead("Page not found", "The page you asked for is not here."), h("div", { class: "wrap" }, h("a", { href: "/", class: "pill" }, "Back to home")));
}
