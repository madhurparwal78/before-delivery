import { useEffect, useRef, useState } from 'react';
import { COPY } from '../copy.js';
import { RequestFailed, get, post } from '../api.js';
import { formatInteger } from '../format.js';
import { Shell } from '../components/Shell.js';
import { Dialog } from '../components/Dialog.js';
import { Banner } from '../components/Banner.js';
import type { Me, PlatformVenue, ProviderHealth } from '../api.js';

const HEALTH_POLL_MS = 10_000;

export function PlatformScreen(props: { me: Me }): React.JSX.Element {
  const [venues, setVenues] = useState<PlatformVenue[]>([]);
  const [health, setHealth] = useState<ProviderHealth | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [status, setStatus] = useState('');
  const [identityDown, setIdentityDown] = useState(false);

  const loadVenues = (): void => {
    void get<{ venues: PlatformVenue[] }>('/api/platform/venues')
      .then((value) => setVenues(value.venues))
      .catch(() => undefined);
  };

  useEffect(() => {
    loadVenues();
    const poll = (): void => {
      void get<ProviderHealth>('/api/platform/health').then(setHealth).catch(() => undefined);
    };
    poll();
    const timer = setInterval(poll, HEALTH_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <Shell me={props.me} path="/platform" field="slate" stickers={['cube']}>
      <h1>Platform</h1>
      {identityDown ? <Banner>{COPY.identityUnavailable}</Banner> : null}

      <section className="card">
        <h2>Venues</h2>
        <button type="button" className="pill" onClick={() => setOnboarding(true)}>
          Onboard venue
        </button>
        <div className="table-scroll">
          <table aria-label="Venues">
            <thead>
              <tr>
                <th scope="col">Slug</th>
                <th scope="col">Name</th>
                <th scope="col">Time zone</th>
                <th scope="col">Members</th>
              </tr>
            </thead>
            <tbody>
              {venues.map((venue) => (
                <tr key={venue.id}>
                  <td>{venue.slug}</td>
                  <td>{venue.name}</td>
                  <td>{venue.time_zone}</td>
                  <td>{formatInteger(venue.member_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" role="region" aria-label="Provider health">
        <h2>Provider health</h2>
        <div className="grid grid--three">
          {Object.entries(health?.providers ?? {}).map(([name, state]) => (
            <div key={name}>
              <span className="label">{name}</span>
              <span className="numeral">{state}</span>
            </div>
          ))}
        </div>
      </section>

      <span className="status" role="status" aria-live="polite" aria-label="Platform updates">
        {status}
      </span>

      {onboarding ? (
        <OnboardDialog
          onClose={() => setOnboarding(false)}
          onStatus={setStatus}
          onIdentityDown={setIdentityDown}
          onDone={() => {
            setOnboarding(false);
            loadVenues();
          }}
        />
      ) : null}
    </Shell>
  );
}

function OnboardDialog(props: {
  onClose: () => void;
  onStatus: (text: string) => void;
  onIdentityDown: (down: boolean) => void;
  onDone: () => void;
}): React.JSX.Element {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [timeZone, setTimeZone] = useState('UTC');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [message, setMessage] = useState('');
  const slugRef = useRef<HTMLInputElement | null>(null);

  const create = async (): Promise<void> => {
    setMessage('');
    try {
      await post('/api/platform/venues', {
        slug,
        name,
        time_zone: timeZone,
        owner_email: ownerEmail,
      });
      props.onIdentityDown(false);
      props.onStatus(`Venue ${slug} onboarded and ${ownerEmail} invited.`);
      props.onDone();
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.code === 'slug_taken') setMessage('That slug is taken.');
      else if (error.code === 'identity_unavailable') {
        props.onIdentityDown(true);
        props.onClose();
      } else setMessage('Check the venue details.');
    }
  };

  return (
    <Dialog label="Onboard venue" initialFocus={slugRef} onClose={props.onClose}>
      <h2>Onboard venue</h2>
      <div className="form-row">
        <label htmlFor="venue-slug">Slug</label>
        <input
          id="venue-slug"
          ref={slugRef}
          type="text"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
        />
      </div>
      <div className="form-row">
        <label htmlFor="venue-name">Name</label>
        <input id="venue-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="form-row">
        <label htmlFor="venue-zone">Time zone</label>
        <input
          id="venue-zone"
          type="text"
          value={timeZone}
          onChange={(event) => setTimeZone(event.target.value)}
        />
      </div>
      <div className="form-row">
        <label htmlFor="venue-owner">Owner email</label>
        <input
          id="venue-owner"
          type="text"
          value={ownerEmail}
          onChange={(event) => setOwnerEmail(event.target.value)}
        />
      </div>
      {message !== '' ? <p className="banner">{message}</p> : null}
      <div className="dialog__actions">
        <button type="button" className="pill" onClick={() => void create()}>
          Onboard venue
        </button>
        <button type="button" className="pill pill--quiet" onClick={props.onClose}>
          Back
        </button>
      </div>
    </Dialog>
  );
}
