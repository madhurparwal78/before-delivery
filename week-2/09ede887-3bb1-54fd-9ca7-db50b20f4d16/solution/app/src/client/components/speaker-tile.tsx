import { useState } from 'react';
import type { Speaker } from '../../shared/api';
import { initials } from '../format';
import { Link } from '../router';

// A speaker on the black wall: monogram, name, company, rendered bio; pointing at the tile
// or focusing it reveals the speaker's sessions, and Escape hides them again.

export function SpeakerTile({ speaker, titles }: { speaker: Speaker; titles: ReadonlyMap<string, string> }) {
  const [hidden, setHidden] = useState(false);
  return (
    <li
      className={hidden ? 'speaker-tile is-quiet' : 'speaker-tile'}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setHidden(true);
      }}
      onMouseLeave={() => setHidden(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHidden(false);
      }}
    >
      <span className="monogram" aria-hidden="true">
        {initials(speaker.name)}
      </span>
      <div className="speaker-text">
        <p className="speaker-name">{speaker.name}</p>
        <p className="speaker-company">{speaker.company}</p>
        {speaker.bio_html && <p className="bio bio-dark" dangerouslySetInnerHTML={{ __html: speaker.bio_html }} />}
        <div className="speaker-sessions">
          {speaker.sessions.map((id) => (
            <Link key={id} to={`/sessions/${encodeURIComponent(id)}`}>
              {titles.get(id) ?? id}
            </Link>
          ))}
        </div>
      </div>
    </li>
  );
}
