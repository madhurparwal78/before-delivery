import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MeResponse } from '../shared/api.js';
import { CE_STATEMENT, EVENT } from '../shared/event.js';
import { CONTENT_UNAVAILABLE_LINE, SIGN_IN_FAILED } from '../shared/copy.js';
import { formatDollars } from '../shared/money.js';
import { PRICES } from '../shared/prices.js';
import { ApiFailure, api } from './api.js';
import { HoldPanel } from './HoldPanel.js';
import { LabChapter } from './LabChapter.js';
import { useReducedMotion, useViewport } from './hooks.js';
import { useLab } from './store.js';
import { CountingNumber, Dialog, Disclosure, ErrorSummary, Field } from './ui.js';

interface Chapter {
  readonly id: string;
  readonly number: string;
  readonly title: string;
}

const CHAPTERS: readonly Chapter[] = [
  { id: 'chapter-overture', number: '01', title: 'Overture' },
  { id: 'chapter-method', number: '02', title: 'Method' },
  { id: 'chapter-two-days', number: '03', title: 'Two days' },
  { id: 'chapter-lab', number: '04', title: 'The lab' },
  { id: 'chapter-evenings', number: '05', title: 'Evenings' },
  { id: 'chapter-venue', number: '06', title: 'Venue' },
  { id: 'chapter-reserve', number: '07', title: 'Reserve' },
];

function goToChapter(id: string): void {
  const element = document.getElementById(id);
  if (element === null) return;
  element.scrollIntoView({ behavior: 'auto', block: 'start' });
  const heading = element.querySelector<HTMLElement>('h1, h2');
  heading?.focus();
}

function useCurrentChapter(): string {
  const [current, setCurrent] = useState(CHAPTERS[0]?.id ?? '');
  useEffect(() => {
    const onScroll = (): void => {
      let best: { id: string; visible: number } | null = null;
      for (const chapter of CHAPTERS) {
        const element = document.getElementById(chapter.id);
        if (element === null) continue;
        const rect = element.getBoundingClientRect();
        const visible =
          Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        if (best === null || visible > best.visible) best = { id: chapter.id, visible };
      }
      if (best !== null) setCurrent(best.id);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);
  return current;
}

function ChapterLinks({ current, onPick }: { readonly current: string; readonly onPick?: () => void }): ReactNode {
  return (
    <>
      {CHAPTERS.map((chapter) => (
        <a
          key={chapter.id}
          href={`#${chapter.id}`}
          aria-current={current === chapter.id ? 'true' : undefined}
          onClick={(event) => {
            event.preventDefault();
            goToChapter(chapter.id);
            onPick?.();
          }}
        >
          <span className="rail-number num">{chapter.number}</span>{' '}
          <span className="rail-title">{chapter.title}</span>
        </a>
      ))}
    </>
  );
}

const SIGNUP_FIELD_IDS: Record<string, string> = {
  name: 'signup-name',
  email: 'signup-email',
  password: 'signup-password',
  clinic_name: 'signup-clinic-name',
};

function SignInDialogs(): ReactNode {
  const lab = useLab();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'practitioner' | 'clinic'>('practitioner');
  const [clinicName, setClinicName] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!lab.signInWanted) return null;

  const close = (): void => {
    setFailure(null);
    setErrors({});
    lab.closeSignIn();
  };

  if (mode === 'signup') {
    return (
      <Dialog name="Create account" onClose={close}>
        <h2>Create account</h2>
        <ErrorSummary errors={errors} fieldIds={SIGNUP_FIELD_IDS} />
        {failure === null || Object.keys(errors).length > 0 ? null : (
          <p className="form-error">{failure}</p>
        )}
        <Field
          label="Name"
          value={name}
          onChange={setName}
          error={errors['name']}
          fieldId={SIGNUP_FIELD_IDS['name']}
        />
        <Field
          label="Email"
          value={email}
          onChange={setEmail}
          error={errors['email']}
          fieldId={SIGNUP_FIELD_IDS['email']}
        />
        <Field
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          error={errors['password']}
          fieldId={SIGNUP_FIELD_IDS['password']}
        />
        <div role="radiogroup" aria-label="Account kind">
          <button
            type="button"
            role="radio"
            aria-checked={kind === 'practitioner'}
            aria-label="Practitioner"
            onClick={() => setKind('practitioner')}
            className={kind === 'practitioner' ? 'tier-on' : ''}
          >
            Practitioner
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={kind === 'clinic'}
            aria-label="Clinic"
            onClick={() => setKind('clinic')}
            className={kind === 'clinic' ? 'tier-on' : ''}
          >
            Clinic
          </button>
        </div>
        {kind === 'clinic' ? (
          <Field
            label="Clinic name"
            value={clinicName}
            onChange={setClinicName}
            error={errors['clinic_name']}
            fieldId={SIGNUP_FIELD_IDS['clinic_name']}
          />
        ) : null}
        <button
          type="button"
          onClick={() => {
            setFailure(null);
            setErrors({});
            void api<{ account: unknown }>('/api/auth/signup', {
              body: {
                name,
                email,
                password,
                kind,
                ...(kind === 'clinic' ? { clinic_name: clinicName } : {}),
              },
            })
              .then(() => api<MeResponse>('/api/me'))
              .then((me) => lab.signedIn(me))
              .catch((error: unknown) => {
                if (error instanceof ApiFailure) {
                  setErrors(error.body.errors ?? {});
                  setFailure(error.body.message);
                }
              });
          }}
        >
          Create account
        </button>
        <button type="button" onClick={close}>
          Close
        </button>
      </Dialog>
    );
  }

  return (
    <Dialog name="Sign in" onClose={close}>
      <h2>Sign in</h2>
      {failure === null ? null : <p className="form-error">{failure}</p>}
      <Field label="Email" value={email} onChange={setEmail} />
      <Field label="Password" value={password} onChange={setPassword} type="password" />
      <button
        type="button"
        onClick={() => {
          setFailure(null);
          void api('/api/auth/signin', { body: { email, password } })
            .then(() => api<MeResponse>('/api/me'))
            .then((me) => lab.signedIn(me))
            .catch(() => setFailure(SIGN_IN_FAILED));
        }}
      >
        Sign in
      </button>
      <button type="button" onClick={() => setMode('signup')}>
        Create an account
      </button>
      <button type="button" onClick={close}>
        Close
      </button>
    </Dialog>
  );
}

function holdClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)
    .toString()
    .padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')}`;
}

function ReserveBar({ phone }: { readonly phone: boolean }): ReactNode {
  const lab = useLab();
  const reduced = useReducedMotion();
  const remaining = lab.benches?.seats_remaining ?? 24;
  const held = lab.holdReservations[0];
  return (
    <div className={phone ? 'reserve-bar reserve-bar-phone' : 'reserve-bar reserve-bar-compact'}>
      <p className="seats">
        <CountingNumber value={remaining} reduced={reduced} /> of <span className="num">24</span>{' '}
        seats remaining
      </p>
      {phone ? (
        <HoldPanel kinetic={false} compact />
      ) : held === undefined ? null : (
        <p className="bar-countdown num">
          Bench {held.bench} {holdClock(lab.holdSecondsRemaining)}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          goToChapter('chapter-lab');
          document
            .getElementById('bench-map')
            ?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
            ?.focus();
        }}
      >
        Reserve a bench
      </button>
    </div>
  );
}

function Agenda(): ReactNode {
  const lab = useLab();
  const [day, setDay] = useState<1 | 2>(1);
  const tabs = useRef(new Map<number, HTMLButtonElement>());
  const sessions = (lab.content?.sessions ?? []).filter((session) => session.day === day);

  const pick = useCallback((next: 1 | 2) => {
    setDay(next);
    tabs.current.get(next)?.focus();
  }, []);

  return (
    <>
      <div className="agenda-tabs" role="tablist" aria-label="Agenda days">
        {([1, 2] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            id={`agenda-tab-${candidate}`}
            aria-selected={day === candidate}
            aria-controls={`agenda-panel-${candidate}`}
            tabIndex={day === candidate ? 0 : -1}
            ref={(element) => {
              if (element === null) tabs.current.delete(candidate);
              else tabs.current.set(candidate, element);
            }}
            className={`agenda-tab${day === candidate ? ' agenda-tab-on' : ''}`}
            onClick={() => pick(candidate)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                pick(candidate === 1 ? 2 : 1);
              }
            }}
          >
            Day <span className="num">{candidate}</span>
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`agenda-panel-${day}`}
        aria-labelledby={`agenda-tab-${day}`}
        className="session-list"
      >
        {sessions.map((session) => (
          <article className="session" key={session.id}>
            <p className="session-number num">{session.number}</p>
            <p className="session-format">{session.format === 'hands-on' ? 'Hands-on' : 'Lecture'}</p>
            <p className="session-minutes num">{session.minutes} min</p>
            <h3>{session.title}</h3>
            <p className="session-outcomes">{session.outcomes}</p>
          </article>
        ))}
      </div>
    </>
  );
}

export function PublicSite(): ReactNode {
  const lab = useLab();
  const viewport = useViewport();
  const current = useCurrentChapter();
  const [menuOpen, setMenuOpen] = useState(false);
  const phone = viewport === 'phone';

  return (
    <div className={`site${phone ? ' site-phone' : ''}`}>
      <header className="site-header">
        <p className="brand">{EVENT.brand}</p>
        {phone ? (
          <button type="button" onClick={() => setMenuOpen(true)}>
            Menu
          </button>
        ) : (
          <ReserveBar phone={false} />
        )}
      </header>

      {phone ? null : (
        <nav className="chapter-rail" aria-label="Chapters">
          <ChapterLinks current={current} />
        </nav>
      )}

      {menuOpen ? (
        <Dialog name="Chapters" onClose={() => setMenuOpen(false)}>
          <h2>Chapters</h2>
          <nav aria-label="Chapters" className="drawer-nav">
            <ChapterLinks current={current} onPick={() => setMenuOpen(false)} />
          </nav>
          <button type="button" onClick={() => setMenuOpen(false)}>
            Close menu
          </button>
        </Dialog>
      ) : null}

      <main>
        <section className="chapter chapter-overture" id="chapter-overture">
          <div className="chapter-inner">
            <h1 className="headline headline-xl" tabIndex={-1}>
              <span>Layered</span>
              <span>Composite</span>
              <span>Masterclass</span>
            </h1>
            <p className="overture-meta">
              {EVENT.dates} · {EVENT.venueName} · {EVENT.city}
            </p>
            <p className="overture-note">
              Two days at a numbered bench. <span className="num">24</span> seats,{' '}
              <span className="num">{EVENT.credits}</span> credits.
            </p>
          </div>
        </section>

        <section className="chapter" id="chapter-method">
          <div className="chapter-inner">
            <h2 className="headline" tabIndex={-1}>
              <span>Method</span>
              <span>before material</span>
            </h2>
            <div className="columns">
              <p>
                You will map shade and translucency on a natural incisor, build a palatal shell from
                a silicone index, layer dentin, effects and enamel to a natural incisal edge, then
                place tight posterior contacts and finish to a lasting gloss.
              </p>
              <p>
                Taught by {EVENT.instructor}, course director at the {EVENT.provider}.
              </p>
              <p className="ce-statement">{CE_STATEMENT}</p>
            </div>
          </div>
        </section>

        <section className="chapter" id="chapter-two-days">
          <div className="chapter-inner">
            <h2 className="headline" tabIndex={-1}>
              <span>Two days</span>
              <span>at the bench</span>
            </h2>
            {lab.contentFailed ? <p>{CONTENT_UNAVAILABLE_LINE}</p> : <Agenda />}
          </div>
        </section>

        <LabChapter viewport={viewport} />

        <section className="chapter" id="chapter-evenings">
          <div className="chapter-inner">
            <h2 className="headline" tabIndex={-1}>
              <span>Evenings</span>
              <span>off the bench</span>
            </h2>
            {lab.contentFailed ? (
              <p>{CONTENT_UNAVAILABLE_LINE}</p>
            ) : (
              <div className="evening-cards">
                {(lab.content?.hospitality ?? []).map((evening) => (
                  <article className="evening-card" key={evening.id}>
                    <h3>{evening.title}</h3>
                    <p className="evening-day">
                      Day <span className="num">{evening.day}</span>
                    </p>
                    <p className="evening-tier">
                      {evening.tier === 'atelier' ? (
                        <>
                          <span aria-hidden="true" className="lock">
                            &#128274;
                          </span>{' '}
                          Atelier guests
                        </>
                      ) : (
                        'All guests'
                      )}
                    </p>
                    <Disclosure
                      buttonLabel={`Details for ${evening.title}`}
                      buttonText="Details"
                      className="evening-details"
                    >
                      {evening.gated === true ? (
                        <p>Atelier guests see the time, venue and description once their seat is paid.</p>
                      ) : (
                        <>
                          <p className="num">{evening.starts_at}</p>
                          <p>{evening.venue}</p>
                          <p>{evening.description}</p>
                        </>
                      )}
                    </Disclosure>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="chapter" id="chapter-venue">
          <div className="chapter-inner">
            <h2 className="headline" tabIndex={-1}>
              <span>Venue</span>
              <span>West Kinzie</span>
            </h2>
            <div className="venue-grid">
              <address>
                {EVENT.venueName}
                <br />
                {EVENT.venueAddress}
              </address>
              <ul className="hotels">
                {(lab.content?.hotels ?? []).map((hotel) => (
                  <li key={hotel.id}>
                    <p className="hotel-name">{hotel.name}</p>
                    <p className="num">{hotel.distance}</p>
                    <p className="num">{hotel.rate}</p>
                    <a
                      href={hotel.map_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`Map for ${hotel.name}`}
                    >
                      Map
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="chapter" id="chapter-reserve">
          <div className="chapter-inner">
            <h2 className="headline" tabIndex={-1}>
              <span>Reserve</span>
              <span>your bench</span>
            </h2>
            <div className="price-grid">
              <div>
                <h3>Bench</h3>
                <p className="num">${formatDollars(PRICES.bench.fullCents)}</p>
                <p className="num">Deposit ${formatDollars(PRICES.bench.depositCents)}</p>
                <p className="num">Balance ${formatDollars(PRICES.bench.balanceCents)}</p>
              </div>
              <div>
                <h3 className="gold">Atelier</h3>
                <p className="num">${formatDollars(PRICES.atelier.fullCents)}</p>
                <p className="num">Deposit ${formatDollars(PRICES.atelier.depositCents)}</p>
                <p className="num">Balance ${formatDollars(PRICES.atelier.balanceCents)}</p>
              </div>
            </div>
            <h3>Deadlines</h3>
            <ul>
              <li>Deposits and balances are due by 19 March 2027.</li>
              <li>From 20 March 2027 a bench is sold on full payment only.</li>
            </ul>
            <h3>Refund schedule</h3>
            <ul>
              <li>
                On or before 15 January 2027: amount paid less $
                <span className="num">{formatDollars(25000)}</span>.
              </li>
              <li>
                16 January to 19 March 2027: <span className="num">50</span>% of the amount paid.
              </li>
              <li>From 20 March 2027: no refund. Assign the seat to a colleague instead.</li>
            </ul>
            <h3>Questions</h3>
            <div className="faq">
              {(lab.content?.faq ?? []).map((entry) => (
                <Disclosure
                  key={entry.id}
                  buttonLabel={entry.question}
                  buttonText={entry.question}
                  className="faq-entry"
                >
                  <p>{entry.answer}</p>
                </Disclosure>
              ))}
            </div>
            <h3>Your account</h3>
            {lab.me === null ? (
              <button type="button" onClick={lab.openSignIn}>
                Sign in
              </button>
            ) : (
              <p>
                Signed in as {lab.me.account.name}. <a href="/account">My seats</a>{' '}
                <button type="button" onClick={() => void lab.signOut()}>
                  Sign out
                </button>
              </p>
            )}
          </div>
        </section>
      </main>

      {phone ? <ReserveBar phone /> : null}
      <SignInDialogs />
    </div>
  );
}
