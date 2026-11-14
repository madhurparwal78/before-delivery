import { useLayoutEffect, useRef } from "react";
import { WORLD_COUNT } from "../../shared/stage-rules";
import { worldAt } from "../boot";
import { focusClear } from "../focus";
import { Link } from "../router";
import { stage } from "../stage/controller";
import { Announcer, useStage, WorldsStage } from "../stage/views";

/** Focus goes where the visitor was: back on the world's Enter button, or its Explore link in the still gallery. */
function restoreWorld(section: HTMLElement, index: number): void {
  const world = worldAt(index);
  if (stage.getSnapshot().mode === "still") {
    focusClear([...section.querySelectorAll<HTMLAnchorElement>("a")].find((link) => link.getAttribute("href") === `/worlds/${world.slug}`));
    return;
  }
  stage.jumpTo(index);
  section.querySelector<HTMLElement>(".overlay-actions .button--primary")?.focus({ preventScroll: true });
}

/** Eight points on a ring: the site in one drawing. */
function OrbitMark() {
  return (
    <svg className="intro-orbit" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <circle cx="200" cy="200" r="190" />
      <circle cx="200" cy="200" r="130" />
      <circle cx="200" cy="200" r="70" />
      {Array.from({ length: WORLD_COUNT }, (_, at) => {
        const angle = (at / WORLD_COUNT) * Math.PI * 2 - Math.PI / 2;
        return <circle key={at} className={at === 0 ? "orbit-world orbit-world--first" : "orbit-world"} cx={200 + Math.cos(angle) * 190} cy={200 + Math.sin(angle) * 190} r={at === 0 ? 9 : 6} />;
      })}
    </svg>
  );
}

export function HomePage() {
  const worlds = useRef<HTMLElement>(null);
  const retrying = useRef(false);
  const { mode } = useStage();

  useLayoutEffect(() => {
    const section = worlds.current as HTMLElement;
    stage.attachSection(section);
    const index = stage.takeReturn();
    if (index !== null) restoreWorld(section, index);
    return () => stage.attachSection(null);
  }, []);

  useLayoutEffect(() => {
    if (mode !== "3d" || !retrying.current) return;
    retrying.current = false;
    stage.jumpTo(1);
    worlds.current?.querySelector<HTMLElement>(".rail-button")?.focus({ preventScroll: true });
  }, [mode]);

  useLayoutEffect(() => {
    const onScroll = () => stage.scrolled();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const enterTheWorlds = () => {
    const section = worlds.current as HTMLElement;
    if (stage.enterTheWorlds()) section.querySelector<HTMLElement>(".rail-button")?.focus({ preventScroll: true });
    else focusClear(section.querySelector<HTMLElement>(".still-list a"));
  };

  const retry = () => {
    retrying.current = true;
    void stage.tryAgain().then((loaded) => {
      if (!loaded) retrying.current = false;
    });
  };

  return (
    <>
      <section className="intro" data-section="intro">
        <OrbitMark />
        <h1 className="intro-title" tabIndex={-1}>
          <span>Eight brands.</span> <span>Eight worlds.</span> <span>One small studio.</span>
        </h1>
        <p className="intro-lede">Vellum Orbit is a two-founder branding and digital design studio in Kochi. Step inside the work.</p>
        <button type="button" className="button button--primary button--large" onClick={enterTheWorlds}>Enter the worlds</button>
      </section>
      <section className={mode === "still" ? "worlds worlds--still" : "worlds"} data-section="worlds" aria-label="Worlds" ref={worlds}>
        <WorldsStage onRetry={retry} />
        <Announcer />
      </section>
      <section className="brief" data-section="studio-in-brief">
        <h2>The studio in brief</h2>
        <p className="prose">We design identities, websites, stores, packaging, applications and content for founders who want their business to look like itself.</p>
        <ul className="link-row">
          <li><Link className="button button--quiet" href="/services">Our services</Link></li>
          <li><Link className="button button--quiet" href="/pricing">See the price list</Link></li>
          <li><Link className="button button--quiet" href="/faq">Questions and answers</Link></li>
          <li><Link className="button button--primary" href="/contact">Start a project</Link></li>
        </ul>
      </section>
    </>
  );
}
