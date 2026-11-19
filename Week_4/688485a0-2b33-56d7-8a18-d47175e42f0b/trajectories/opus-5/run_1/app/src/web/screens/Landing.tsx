import { useEffect, useState } from 'react';
import { PreviewAnswer, SessionUser, apiGet } from '../api';
import { LANDING_LINE } from '../copy';
import { SieveBand } from '../components/StageSieve';
import { TopBar } from '../components/Shell';
import { useReducedMotion } from '../hooks';
import { navigate } from '../router';

function operatorOf(text: string): string {
  const keys = Object.keys(JSON.parse(text) as Record<string, unknown>);
  return keys[0] ?? '$match';
}

/** The hero card runs the published sample pipeline over the houseplant collection. */
export function LandingScreen({ user }: { user: SessionUser | null }): JSX.Element {
  const [sample, setSample] = useState<PreviewAnswer | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    let live = true;
    void apiGet<PreviewAnswer>('/api/sample/sieve')
      .then((answer) => {
        if (live) setSample(answer);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const pipeline = sample?.pipeline ?? [];

  return (
    <div>
      <TopBar user={user} />
      <div className="hero">
        <div className="hero-text">
          <h1 className="wordmark">
            <span className="swipe">JAR</span>FUL
          </h1>
          <p className="hero-line">{LANDING_LINE}</p>
          <div className="hero-actions">
            <a
              className="primary"
              href="/signup"
              onClick={(event) => {
                event.preventDefault();
                navigate('/signup');
              }}
            >
              Start a project
            </a>
            <a
              href="/signin"
              onClick={(event) => {
                event.preventDefault();
                navigate('/signin');
              }}
            >
              Sign in
            </a>
          </div>
        </div>
        <section className="hero-card" aria-label="Stage Sieve sample" aria-busy={sample ? undefined : 'true'}>
          <ul className="sieve">
            {(sample?.stages ?? []).map((stage) => (
              <li
                key={stage.index}
                className="stage-card"
                data-stage-index={stage.index}
                data-stage-count={stage.count}
                data-capped="false"
                data-disabled={stage.disabled ? 'true' : 'false'}
              >
                <div className="stage-head">
                  <span className="stage-label">
                    <span className="stage-number count">{stage.index + 1}</span>{' '}
                    {pipeline[stage.index] ? operatorOf(pipeline[stage.index]) : ''}
                  </span>
                </div>
                <SieveBand
                  band={{
                    index: stage.index,
                    label: pipeline[stage.index] ? operatorOf(pipeline[stage.index]) : '',
                    count: stage.count,
                    disabled: stage.disabled,
                    capped: false,
                  }}
                  total={sample?.stages.length ?? 0}
                  input={sample?.input ?? 0}
                  limit={0}
                  animateFrom={0}
                  reduced={reduced}
                  pin={null}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
