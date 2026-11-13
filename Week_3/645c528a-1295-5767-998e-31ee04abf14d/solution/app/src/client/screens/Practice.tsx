import { useState, type ReactNode } from 'react';
import { navigate } from '../router';
import type { Store } from '../store';
import { RackGlyph, Screen } from '../ui';
import { DIFFICULTIES, beginPractice, savedRack, type PracticeKind } from '../table/practice';

export function PracticeSetup({ store }: { store: Store }): ReactNode {
  const [difficulty, setDifficulty] = useState<PracticeKind>('Rookie');
  const [saved, setSaved] = useState(savedRack);
  const start = (): void => {
    beginPractice(difficulty, false);
    navigate('/practice/table');
  };
  return (
    <Screen store={store} title="Practice">
      {saved !== null && (
        <section className="tournament-card" role="region" aria-label="Unfinished rack">
          <h2>Resume your unfinished rack?</h2>
          <div className="home-actions">
            <button type="button" className="primary" onClick={() => {
              beginPractice(saved.difficulty, true);
              navigate('/practice/table');
            }}>Resume rack</button>
            <button type="button" onClick={() => {
              beginPractice(saved.difficulty, false);
              setSaved(null);
            }}>New rack</button>
          </div>
        </section>
      )}
      <div className="radio-row difficulty" role="radiogroup" aria-label="Difficulty">
        {[...DIFFICULTIES, 'Free table' as const].map((name) => (
          <label className="radio" key={name}>
            <input type="radio" name="difficulty" checked={difficulty === name} onChange={() => setDifficulty(name)} />
            {name}
          </label>
        ))}
      </div>
      <div className="home-actions">
        <button type="button" className="primary" onClick={start}>Start rack</button>
        <span className="practice-glyph"><RackGlyph /></span>
      </div>
    </Screen>
  );
}
