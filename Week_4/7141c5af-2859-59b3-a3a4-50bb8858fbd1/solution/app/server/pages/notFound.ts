import { copy } from "../domain/copy.ts";
import { asImage, chairSvg } from "../../web/shared/dots.ts";
import { document } from "./document.ts";
import { siteFooter, siteHeader } from "./public.ts";

/** The server's 404 page: the same for an unknown address, another desk's id and an erased client's records. */
export function notFoundPage(): string {
  const heading = copy("F-100");
  return document({
    title: heading,
    script: "public",
    body: `${siteHeader()}<main id="main" class="page not-found" data-page="home">
<div class="bento">
<div class="tile t-large form-tile"><h1 tabindex="-1">${heading}</h1><div class="not-found-art">${asImage(chairSvg("folding-empty", { tone: "muted" }))}</div></div>
<div class="tile tile--mint t-medium form-claim"><span class="mint-label">Status</span><span class="mint-figure">404</span><p><a class="link-row" href="/">Bottega Semenza</a></p></div>
</div>
</main>${siteFooter()}`,
  });
}
