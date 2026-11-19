import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { get } from "../api.js";
import { reducedMotion } from "../focus.js";
import { SAMPLE_PIPELINE, SAMPLE_SIZE } from "../../shared/sample.js";
import { displayNumber } from "../../shared/display.js";
import type { JsonObject } from "../../shared/json.js";
import { SieveMeter, barFraction, useSieveMotion } from "../components/Sieve.js";
import { Link } from "../router.js";

interface Sample {
  input: number;
  stages: { index: number; count: number }[];
}

const NOTES = ["only the bright rooms", "one row per pot size", "count pots by family", "most pots first"];

export function Landing(): ReactNode {
  const [sample, setSample] = useState<Sample | null>(null);
  const motion = useSieveMotion();
  useEffect(() => {
    get<Sample>("/api/sample/sieve").then(setSample, () => setSample(null));
  }, []);
  useLayoutEffect(() => {
    if (!sample) return;
    motion.update(
      sample.stages.map((stage) => ({ key: `hero-${stage.index}`, fraction: barFraction(stage.count, sample.input), count: stage.count })),
      0,
      reducedMotion(),
    );
  }, [sample, motion]);
  return (
    <main className="landing">
      <section className="hero-text">
        <h1 className="wordmark">
          <span className="swipe">JAR</span>FUL
        </h1>
        <p className="tagline">Keep, shape and share your JSON documents in one bright jar.</p>
        <p className="actions">
          <Link to="/signup" className="btn btn-lime">
            Start a project
          </Link>
          <Link to="/signin" className="text-link">
            Sign in
          </Link>
        </p>
      </section>
      <section className="hero-card" aria-label="Stage Sieve sample" aria-busy={sample === null || undefined}>
        <p className="hero-card-title">
          Houseplants <span>{displayNumber(SAMPLE_SIZE)} documents in</span>
        </p>
        <ol className="sieve-list">
          {SAMPLE_PIPELINE.map((stage, index) => {
            const found = sample?.stages[index];
            return (
              <li
                key={index}
                className="sieve-band hero-band"
                data-stage-index={index}
                data-stage-count={found?.count}
                data-capped="false"
                data-disabled="false"
              >
                <span className="band-label">
                  <span className="band-op">{Object.keys(stage as JsonObject)[0]}</span>
                  <span className="band-note">{NOTES[index]}</span>
                </span>
                <SieveMeter motion={motion} id={`hero-${index}`} disabled={false} overflow={found !== undefined && sample !== null && found.count > sample.input} />
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
