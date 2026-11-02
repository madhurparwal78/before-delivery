import { ArrowRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { Turntable } from "../can/Turntable";
import { Border } from "../components/Border";
import { Faq } from "../components/Faq";
import { REDUCED, useMedia } from "../lib/media";
import { Link } from "../lib/router";

const SCENES = [
  {
    name: "Canopy",
    heading: "Grown under the canopy",
    message: "Organic yerba mate, shade-grown and cold-brewed, then sparkled in small batches.",
    detail: "Our mate grows under native forest cover in Misiones, picked by the families who tend it.",
  },
  {
    name: "River",
    heading: "Lightly sparkling, lightly sweet",
    message: "Every can carries about 80 mg of caffeine from mate leaves and 30 calories or fewer.",
    detail: "Fine bubbles, real fruit and just enough organic cane sugar to round off the mate.",
  },
  {
    name: "Orchard",
    heading: "Build your crate",
    message: "Mix any 12 cans. Your crate holds them while you shop.",
    detail: "Pick a single flavour or a mix. Subscribers save 10% on 12 of one flavour or 4 of each.",
  },
  {
    name: "Night sky",
    heading: "Every province, exact to the cent",
    message: "Tax, deposit and shipping are shown before you pay.",
    detail: "GST, HST, PST and QST are worked out for your province, and deposits are never taxed.",
  },
];

export function Home() {
  const scenes = useRef<(HTMLElement | null)[]>([]);
  const reduced = useMedia(REDUCED);

  useEffect(() => {
    if (reduced) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) entry.target.classList.toggle("is-in", entry.intersectionRatio >= 0.33);
      },
      { threshold: [0, 0.33, 0.34, 0.6, 1] },
    );
    for (const el of scenes.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [reduced]);

  return (
    <div className={`home ${reduced ? "is-reduced" : ""}`}>
      <div className="can-stage">
        <Turntable scenes={scenes} />
      </div>
      {SCENES.map((scene, i) => (
        <section
          key={scene.name}
          ref={(el) => {
            scenes.current[i] = el;
          }}
          className={`scene scene-${i + 1}`}
          aria-label={scene.name}
        >
          {i > 0 && <Border seed={1009 * i + 17} className="scene-border" />}
          <div className="scene-copy">
            <p className="scene-kicker">{`0${i + 1} — ${scene.name}`}</p>
            <h2 className="scene-heading">{scene.heading}</h2>
            <p className="scene-message">{scene.message}</p>
            <p className="scene-detail">{scene.detail}</p>
            {i === 2 && (
              <Link href="/box" className="btn btn-primary scene-cta">
                Build your crate
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            )}
            {i === 3 && <Faq />}
          </div>
        </section>
      ))}
      <Border seed={4219} className="closing-border" />
    </div>
  );
}
