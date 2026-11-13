import { useMemo, useState } from 'react';
import { formatSimilarity, nearestNeighbours, type NeighboursSeed } from '../../../shared/exhibits.js';
import { neighbourAnnouncement } from '../../../shared/copy.js';

export function NeighboursExhibit({ seed, onUse }: { seed: NeighboursSeed; onUse: () => void }): JSX.Element {
  const words = useMemo(() => [...seed.words].map((entry) => entry.word).sort((a, b) => a.localeCompare(b)), [seed]);
  const [word, setWord] = useState(words[0] ?? 'bank');
  const [context, setContext] = useState('');

  const neighbours = useMemo(
    () => nearestNeighbours(seed, word, context === '' ? null : context),
    [seed, word, context],
  );

  return (
    <div className="exhibit">
      <span className="catalogue">HRR-VIII-01</span>
      <h3>Word neighbours</h3>
      <p>
        Ten words, three coordinates each. Add a context and the query moves, so the nearest words move with it.
      </p>
      <div className="rule-row">
        <div>
          <label htmlFor="neighbour-word">Word</label>
          <select
            id="neighbour-word"
            aria-label="Word"
            value={word}
            onChange={(event) => {
              setWord(event.target.value);
              onUse();
            }}
          >
            {words.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="neighbour-context">Context</label>
          <select
            id="neighbour-context"
            aria-label="Context"
            value={context}
            onChange={(event) => {
              setContext(event.target.value);
              onUse();
            }}
          >
            <option value="">None</option>
            {seed.contexts.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="table-scroll">
        <table aria-label="Neighbours">
          <thead>
            <tr>
              <th scope="col">Word</th>
              <th scope="col">Similarity</th>
            </tr>
          </thead>
          <tbody>
            {neighbours.map((neighbour) => (
              <tr key={neighbour.word}>
                <th scope="row">{neighbour.word}</th>
                <td className="figure">{formatSimilarity(neighbour.similarity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p role="status" aria-label="Neighbour results" className="readout">
        {neighbourAnnouncement(
          word,
          context === '' ? null : context,
          neighbours.map((neighbour) => neighbour.word),
        )}
      </p>
    </div>
  );
}
