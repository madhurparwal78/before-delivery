import { useEffect } from "react";
import { BuildPoster } from "../landing/BuildPoster";
import { ClosingBand } from "../landing/ClosingBand";
import { Editors } from "../landing/Editors";
import { FeatureRows } from "../landing/FeatureRows";
import { Hero } from "../landing/Hero";
import { Starters } from "../landing/Starters";
import { StatsBand } from "../landing/StatsBand";
import { useDestinations } from "../landing/destinations";
import { Link } from "../lib/router";
import "../landing/landing.css";

/** Arriving with a `#section` in the address (a header nav link from another page) scrolls that section into view. */
function useScrollToHash(): void {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
}

export default function Landing() {
  const { classroom } = useDestinations();
  useScrollToHash();
  return (
    <div className="landing">
      <div className="hero-wrap">
        <Hero />
        <div className="column poster-slot">
          <BuildPoster />
        </div>
      </div>
      <section className="intro">
        <div className="column">
          <p className="intro-lead">
            Quarkyard is a browser maker studio for after-school classes. Children join with a class code and a nickname, build in three editors, and you watch every model take shape from one roster.
          </p>
          <div className="pill-row intro-actions">
            <Link to={classroom} className="pill">Start a classroom</Link>
            <Link to="/join" className="pill pill--outline">Join a class</Link>
          </div>
        </div>
      </section>
      <Editors />
      <StatsBand />
      <FeatureRows />
      <Starters />
      <ClosingBand />
    </div>
  );
}
