import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PublicLiveEvent, TonightResponse } from '../../shared/types';
import { RoomPortrait } from '../components/RoomPortrait';
import { OutageBanners } from '../components/Shell';
import { apiGet } from '../lib/api';
import { COPY, roomCaption } from '../lib/format';
import { useEventStream } from '../lib/hooks';

export function Home(): JSX.Element {
  const [tonight, setTonight] = useState<TonightResponse | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setTonight(await apiGet<TonightResponse>('/api/tonight'));
    } catch {
      // The captions keep their last figures until the next refresh.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load]);

  useEventStream<PublicLiveEvent>(
    tonight ? `/api/floor/events?date=${tonight.date}` : null,
    () => void load(),
    () => void load(),
  );

  return (
    <div className="home">
      <OutageBanners />
      <h1 className="home-title">SAFFRON &amp; SLATE</h1>
      {tonight === null ? <p className="single-sentence">{COPY.planLoading}</p> : null}
      <div className="home-run">
        {(tonight?.rooms ?? []).map((room, index) => (
          <figure
            key={room.room_id}
            aria-label={room.name}
            className={`room-panel room-panel--${index % 2 === 0 ? 'a' : 'b'}`}
          >
            <RoomPortrait roomId={room.room_id} />
            <figcaption className="room-caption">
              {roomCaption(room, tonight?.next_slot ?? null)}
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="home-sentence">{COPY.guestSentence}</p>
      <Link className="button button--accent home-book" to="/book">
        Book a table
      </Link>
    </div>
  );
}
