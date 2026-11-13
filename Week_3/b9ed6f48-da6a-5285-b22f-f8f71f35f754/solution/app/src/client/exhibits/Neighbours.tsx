// Chapter VIII: word neighbours in context (brief: Exhibits › Neighbours).

import { useState } from "react";
import { nearestWords, type NeighboursSeed } from "../../shared/exhibits.js";
import { copyFor } from "../../shared/copy.js";

export function NeighboursExhibit({ seed, onUse }: { seed: NeighboursSeed; onUse: () => void }) {
  const words = seed.words.map((w) => w.word).sort((a, b) => a.localeCompare(b));
  const [word, setWord] = useState(words[0]);
  const [context, setContext] = useState<string | null>(null);
  const nearest = nearestWords(seed, word, context);
  return (
    <div className="exhibit neighbours-exhibit">
      <div className="exhibit-controls">
        <div className="select-field">
          <label htmlFor="neighbour-word">Word</label>
          <select
            id="neighbour-word"
            value={word}
            onChange={(e) => {
              onUse();
              setWord(e.currentTarget.value);
            }}
          >
            {words.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <div className="select-field">
          <label htmlFor="neighbour-context">Context</label>
          <select
            id="neighbour-context"
            value={context ?? ""}
            onChange={(e) => {
              onUse();
              setContext(e.currentTarget.value || null);
            }}
          >
            <option value="">None</option>
            {seed.contexts.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div role="status" aria-label="Neighbour results" className="exhibit-status">
        {copyFor.neighbours(word, context, nearest.map((n) => n.word))}
      </div>
      <table aria-label="Neighbours" className="data-table neighbours">
        <thead>
          <tr>
            <th scope="col">Word</th>
            <th scope="col">Similarity</th>
          </tr>
        </thead>
        <tbody>
          {nearest.map((n) => (
            <tr key={n.word}>
              <td>{n.word}</td>
              <td className="figure">{n.similarity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
