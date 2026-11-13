import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../app';
import { Glyph } from '../components/glyphs';
import { Shell, useShell } from '../shell';

interface PatternEntry {
  id: string;
  name: string;
  state: 'draft' | 'published';
  role: 'owner' | 'co-designer' | 'tester';
}

function PatternCards({ patterns }: { patterns: PatternEntry[] }): JSX.Element {
  const { navigate } = useApp();
  return (
    <ul aria-label="Patterns" className="pattern-cards">
      {patterns.map((pattern) => {
        const href = pattern.role === 'tester' ? `/follow/${pattern.id}` : `/patterns/${pattern.id}`;
        return (
          <li key={`${pattern.id}-${pattern.role}`}>
            <a
              className="card pattern-card"
              href={href}
              onClick={(event) => {
                event.preventDefault();
                navigate(href);
              }}
            >
              <span className={pattern.role === 'tester' ? 'tile tile-butter' : 'tile tile-sage'} aria-hidden="true">
                <Glyph stitch="k" craft="knit" />
              </span>
              <span className="card-label">{pattern.name}</span>
              <span className="card-arrow" aria-hidden="true">
                &rarr;
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function HomeScreen(): JSX.Element {
  const { layout, navigate } = useApp();
  const { openNewPattern } = useShell();
  const [patterns, setPatterns] = useState<PatternEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<{ patterns: PatternEntry[] }>('/api/patterns');
        setPatterns(data.patterns);
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  const useSample = async (): Promise<void> => {
    setBusy(true);
    const made = await api.post<{ id: string }>('/api/patterns', { sample: true });
    navigate(`/patterns/${made.id}`);
  };

  if (failed) return <Shell lead="This page could not be loaded. Reload to try again." />;
  if (!patterns) return <Shell lead="Loading..." />;

  return (
    <Shell lead="Your charts and the rows they write.">
      <h1>Your patterns</h1>
      {layout === 'phone' ? (
        <button type="button" className="primary" onClick={openNewPattern}>
          New pattern
        </button>
      ) : null}
      {patterns.length === 0 ? (
        <>
          <ul aria-label="Patterns" className="pattern-cards">
            <li>No patterns yet. Start one from the sample or a blank chart.</li>
          </ul>
          <button type="button" onClick={useSample} disabled={busy} aria-busy={busy}>
            Use the sample
          </button>
        </>
      ) : (
        <PatternCards patterns={patterns} />
      )}
    </Shell>
  );
}
