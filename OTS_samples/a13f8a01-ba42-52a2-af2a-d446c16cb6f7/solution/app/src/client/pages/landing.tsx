import { useEffect, useRef, useState } from "react";
import type { PenSummary } from "../../shared/types.js";
import { api } from "../api.js";
import { CrossfadeStage } from "../components/crossfade-stage.js";
import { Shell } from "../components/shell.js";

const STARTER_TAGS = ["canvas", "css-grid", "type", "physics"] as const;
const STARTER_OWNER = "coldframe";

const SECTIONS = [
  {
    heading: "Pinned libraries",
    body: "Pens load libraries only from a small shelf that Ashlar serves itself, so a sketch never breaks because a public file moved.",
  },
  {
    heading: "Every save is a version",
    body: "Each save is stored exactly as written. Walk the core sample, compare two versions line by line and restore the one that worked.",
  },
  {
    heading: "Embeds that keep working",
    body: "Share a pen on the tab you choose. The embed opens there, runs the head version and keeps working.",
  },
] as const;

export function LandingPage(): React.JSX.Element {
  const [starters, setStarters] = useState<(string | null)[]>([null, null, null, null]);
  const [active, setActive] = useState(1);
  const headings = useRef<(HTMLHeadingElement | null)[]>([]);

  useEffect(() => {
    void api.get<{ pens: PenSummary[] }>("/api/search?q=tag:starter").then((answer) => {
      setStarters(
        STARTER_TAGS.map((tag) => answer.pens.find((pen) => pen.owner === STARTER_OWNER && pen.tags.includes(tag))?.id ?? null),
      );
    });
  }, []);

  useEffect(() => {
    const follow = (): void => {
      const crossed = headings.current.filter((heading) => heading && heading.getBoundingClientRect().top <= window.innerHeight / 2 + 1);
      setActive(1 + crossed.length);
    };
    follow();
    window.addEventListener("scroll", follow, { passive: true });
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow);
      window.removeEventListener("resize", follow);
    };
  }, []);

  return (
    <div className="landing">
      <Shell landing>
        <section aria-label="Starter pen" data-starter={active} className="landing-inset">
          <CrossfadeStage penId={starters[active - 1] ?? null} label="A live starter pen" />
        </section>
        <div className="hero">
          <p className="lede">Write a little HTML, CSS and JavaScript. Watch it run. Keep every version.</p>
          <h1 className="wordmark">ashlar</h1>
        </div>
        <div className="landing-copy">
          {SECTIONS.map((section, index) => (
            <section key={section.heading} className="landing-section">
              <h2
                ref={(element) => {
                  headings.current[index] = element;
                }}
              >
                {section.heading}
              </h2>
              <p>{section.body}</p>
            </section>
          ))}
        </div>
      </Shell>
    </div>
  );
}
