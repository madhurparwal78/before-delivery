import { html } from "./html.js";
import { renderDocument } from "./layout.js";

export function notFoundPage(): string {
  const main = html`<section class="not-found" aria-labelledby="page-title">
    <div class="sheet not-found-inner">
      <h1 class="case-title" id="page-title" tabindex="-1">This page took a wrong turn.</h1>
      <p class="not-found-copy">The address may be mistyped, or the page may have moved.</p>
      <a class="button button-solid" href="/">Back to the homepage</a>
    </div>
  </section>`;
  return renderDocument({ kind: "not-found", title: "Not found | Ottoline Rask", main });
}
