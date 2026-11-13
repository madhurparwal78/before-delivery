import type { Ref } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { COPY } from "../../shared/copy";
import { Icon } from "../lib/icons";
import { measure } from "../stage/paint";

/** The shout is fitted so its longer line spans 74% of the screen: always wider than half. */
function fitShout(): void {
  const h1 = document.querySelector<HTMLElement>(".shout");
  if (!h1) return;
  const unit = measure("COLD DRINK", "display", 100);
  const width = (innerWidth - 40) * 0.74;
  if (unit > 0) h1.style.setProperty("--shout", `${(width / unit) * 100}px`);
}

export function Hero({ heroRef, archRef, onRead }: { heroRef: Ref<HTMLElement>; archRef: Ref<HTMLDivElement>; onRead: () => void }) {
  useLayoutEffect(() => {
    fitShout();
    addEventListener("resize", fitShout);
    document.fonts?.addEventListener("loadingdone", fitShout);
    void document.fonts?.load('100px "Bebas Neue"').then(fitShout);
    return () => {
      removeEventListener("resize", fitShout);
      document.fonts?.removeEventListener("loadingdone", fitShout);
    };
  }, []);
  return (
    <section id="now-showing" class="hero reel" aria-label="Now Showing" ref={heroRef}>
      <h1 class="shout" aria-label="COLD DRINK HOUSE FULL">
        <span aria-hidden="true">COLD DRINK</span>
        <span aria-hidden="true">HOUSE FULL</span>
      </h1>
      <div class="hero-band">
        <p class="hero-sentence">{COPY.heroSentence}</p>
        <a
          class="rect-button"
          href="#the-pack"
          onClick={(e) => {
            e.preventDefault();
            onRead();
          }}
        >
          <span>Read your pack</span>
          <Icon name="arrow" size={20} />
        </a>
      </div>
      <div class="arch" ref={archRef} role="img" aria-label="Pack under the lamp" />
    </section>
  );
}
