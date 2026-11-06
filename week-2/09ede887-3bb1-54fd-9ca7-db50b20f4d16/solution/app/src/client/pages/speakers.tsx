import { useEffect, useState } from 'react';
import type { Speaker } from '../../shared/api';
import { OUTAGE_COPY } from '../copy';
import { loadSessions, loadSpeakers } from '../data';
import { useTitle } from '../hooks';
import { Loading } from '../components/chrome';
import { SpeakerTile } from '../components/speaker-tile';

export function SpeakersPage() {
  useTitle('Speakers');
  const [speakers, setSpeakers] = useState<Speaker[] | null>(null);
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const [outage, setOutage] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([loadSpeakers(), loadSessions(null)]).then(([list, sessions]) => {
      if (!live) return;
      if (!list) setOutage(true);
      setSpeakers(list);
      setTitles(new Map((sessions ?? []).map((session) => [session.id, session.title])));
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="speakers-page">
      <header className="speakers-banner">
        <h1 className="boxed-title">Speakers</h1>
        <p className="helper helper-dark">Point at a speaker, or Tab to one, to see their sessions and jump straight to them.</p>
      </header>
      <div className="page wall-page">
        {!speakers && (outage ? <p className="helper">{OUTAGE_COPY}</p> : <Loading />)}
        {speakers && (
          <ul className="speaker-wall" aria-label="Speakers">
            {speakers.map((speaker) => (
              <SpeakerTile key={speaker.slug} speaker={speaker} titles={titles} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
