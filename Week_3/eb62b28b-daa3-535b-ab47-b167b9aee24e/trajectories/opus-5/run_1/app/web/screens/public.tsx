import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../app/api';
import {
  Link,
  Problems,
  focusProblems,
  useAnnounce,
  useFieldErrors,
  useRouter,
  useSession,
} from '../app/shell';
import { BottomBar, Card, CloudField, Glyph, RadioGroup, SelectField, TextField, Accordion } from '../components/pieces';
import {
  CATEGORIES,
  Cadence,
  MARKERS,
  STATES,
  cadenceLabel,
  copy,
  formatMoney,
  perMonthCents,
  plusPriceCents,
} from '../app/types';

const PARTNERS = [
  'Saguaro Diagnostics',
  'Mesa Clinical Labs',
  'Copperline Pathology',
  'Bluebird Assay Partners',
  'Red Rock Reference Lab',
  'Palo Verde Analytics',
];

export function PublicHeader(): JSX.Element {
  const [solid, setSolid] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const exploreRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onScroll = (): void => setSolid(window.scrollY >= 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        exploreRef.current?.focus();
      }
    };
    const onClick = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (
        !panelRef.current?.contains(target) &&
        !exploreRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [menuOpen]);

  return (
    <header className="site-header" data-state={solid ? 'solid' : 'top'}>
      <div className="bar">
        <Link to="/" className="brand">
          <Glyph kind="marker" />
          Ocotillo Longevity Club
        </Link>
        <div className="header-spacer" />
        <nav aria-label="Main">
          <ul>
            <li>
              <button
                type="button"
                className="quiet"
                ref={exploreRef}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') setMenuOpen(true);
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType !== 'mouse') return;
                  window.setTimeout(() => {
                    if (
                      !panelRef.current?.matches(':hover') &&
                      !exploreRef.current?.matches(':hover')
                    ) {
                      setMenuOpen(false);
                    }
                  }, 0);
                }}
              >
                Explore
              </button>
            </li>
            <li>
              <Link to="/plans">Plans</Link>
            </li>
            <li>
              <Link to="/markers">Marker catalog</Link>
            </li>
            <li>
              <Link to="/signin">Sign in</Link>
            </li>
          </ul>
        </nav>
      </div>
      {menuOpen ? (
        <div
          className="mega"
          ref={panelRef}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setMenuOpen(false);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') setMenuOpen(false);
          }}
        >
          <nav aria-label="Explore">
            <ul>
              <li>
                <Link to="/me/results" aria-label="Marker band">
                  <Glyph kind="marker" />
                  <span>Marker band</span>
                  <span className="muted">Your values on one calm band.</span>
                </Link>
              </li>
              <li>
                <Link to="/plans" aria-label="At-home draws">
                  <Glyph kind="tube" />
                  <span>At-home draws</span>
                  <span className="muted">Fasting draws in your own morning.</span>
                </Link>
              </li>
              <li>
                <Link to="/plans" aria-label="Supplement packets">
                  <Glyph kind="packet" />
                  <span>Supplement packets</span>
                  <span className="muted">Morning and evening, packed for you.</span>
                </Link>
              </li>
              <li>
                <Link to="/plans" aria-label="Plans">
                  <Glyph kind="plan" />
                  <span>Plans</span>
                  <span className="muted">Free and Plus, side by side.</span>
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      ) : null}
    </header>
  );
}

function PartnerStrip(): JSX.Element {
  return (
    <div className="partners" role="region" aria-label="Lab partners" tabIndex={0}>
      <div className="track">
        {[...PARTNERS, ...PARTNERS].map((partner, index) => (
          <span key={`${partner}-${index}`}>{partner}</span>
        ))}
      </div>
    </div>
  );
}

export function HomeScreen(): JSX.Element {
  return (
    <>
      <div className="hero">
        <CloudField />
        <div className="hero-text">
          <h1>Ocotillo Longevity Club</h1>
          <p>
            A founder-run longevity practice in Scottsdale. At-home fasting draws in your own
            morning, results on one calm band, and a plan written by your specialist.
          </p>
          <Link to="/plans" className="button">
            See plans
          </Link>
        </div>
      </div>
      <PartnerStrip />
      <div className="grid two">
        <Card>
          <Glyph kind="tube" />
          <h2>At-home draws</h2>
          <p>A visiting phlebotomist comes to you, in 20-minute slots from 06:00 to 09:40.</p>
        </Card>
        <Card>
          <Glyph kind="marker" />
          <h2>The marker band</h2>
          <p>Every value sits on its own band, flagged against the range in force that day.</p>
        </Card>
        <Card>
          <Glyph kind="packet" />
          <h2>Supplement packets</h2>
          <p>Your blend, packed into a morning and an evening packet of at most four capsules.</p>
        </Card>
      </div>
      <BottomBar>
        <Link to="/plans" className="button">
          See plans
        </Link>
      </BottomBar>
    </>
  );
}

function Roll({ text, part, className }: { text: string; part: string; className: string }): JSX.Element {
  const [previous, setPrevious] = useState<string | null>(null);
  const last = useRef(text);
  useEffect(() => {
    if (last.current !== text) {
      setPrevious(last.current);
      last.current = text;
    }
  }, [text]);
  return (
    <span className={className} data-part={part}>
      {previous !== null && previous !== text ? (
        <span className="roll-out" aria-hidden="true" onAnimationEnd={() => setPrevious(null)}>
          {previous}
        </span>
      ) : null}
      <span className="roll-in" key={text}>
        {text}
      </span>
    </span>
  );
}

const COMPARISON: [string, string, string][] = [
  ['At-home blood draws', 'None', 'Two a year'],
  ['Results on the marker band', 'No', 'Yes'],
  ['Written longevity plan', 'No', 'Yes'],
  ['Custom supplement blend', 'No', 'Yes, member price'],
  ['Care messages', 'No', 'Yes'],
  ['Marker catalog', 'Yes', 'Yes'],
];

export function PlansScreen(): JSX.Element {
  const [cadence, setCadence] = useState<Cadence>('sixMonths');
  const [state, setState] = useState('co');
  const [answer, setAnswer] = useState('');
  const { announce } = useAnnounce();
  const { user } = useSession();
  const { navigate } = useRouter();

  const priceText =
    cadence === 'sixMonths'
      ? `${formatMoney(plusPriceCents('sixMonths'))} every 6 months`
      : `${formatMoney(plusPriceCents('yearly'))} a year`;
  const perMonthText = `${formatMoney(perMonthCents(cadence))} a month`;

  const checkState = async (): Promise<void> => {
    announce(copy.working);
    const result = await api<{ message: string }>(`/api/states/${state}`);
    const message = result.data?.message ?? '';
    setAnswer(message);
    announce(message);
  };

  const join = (): void => navigate(user ? '/me/membership' : '/join');

  return (
    <>
      <h1 tabIndex={-1}>Plans</h1>
      <RadioGroup
        label="Billing cadence"
        name="cadence"
        value={cadence}
        onChange={(value) => setCadence(value as Cadence)}
        options={[
          { value: 'sixMonths', label: cadenceLabel.sixMonths },
          { value: 'yearly', label: cadenceLabel.yearly },
        ]}
      />
      <div className="plan-cards">
        <Card>
          <h2>Free</h2>
          <p className="price">$0</p>
          <p>Browse the marker catalog and keep your account.</p>
          <Link to="/join" className="button">
            Create a free account
          </Link>
        </Card>
        <Card>
          <h2>Plus</h2>
          <Roll text={priceText} part="price" className="price" />
          <Roll text={perMonthText} part="per-month" className="per-month" />
          <p>Two at-home draws a year, the marker band, a plan and your blend.</p>
          <button type="button" onClick={join}>
            Join Plus
          </button>
        </Card>
      </div>
      <Card>
        <table>
          <caption>Compare Free and Plus</caption>
          <thead>
            <tr>
              <th scope="col">What you get</th>
              <th scope="col">Free</th>
              <th scope="col">Plus</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row[0]}>
                <th scope="row">{row[0]}</th>
                <td>{row[1]}</td>
                <td>{row[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <h2>Is your state served?</h2>
        <SelectField
          label="Your state"
          name="state"
          value={state}
          onChange={setState}
          options={STATES.map((entry) => ({ value: entry.state, label: entry.name }))}
        />
        <button type="button" onClick={() => void checkState()}>
          Check state
        </button>
        {answer === '' ? null : <p>{answer}</p>}
        <p>
          <Link to="/markers">See the marker catalog</Link>
        </p>
      </Card>
      <BottomBar>
        <button type="button" onClick={join}>
          Join Plus
        </button>
      </BottomBar>
    </>
  );
}

interface CatalogCategory {
  id: string;
  name: string;
  markers: { id: string; name: string; unit: string }[];
}

export function MarkersScreen(): JSX.Element {
  const { search, navigate } = useRouter();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const openFromUrl = (params.get('open') ?? '').split(',').filter((id) => id !== '');
  const queryFromUrl = params.get('q') ?? '';
  const [text, setText] = useState(queryFromUrl);
  const [categories, setCategories] = useState<CatalogCategory[]>(() =>
    CATEGORIES.map((category) => ({
      id: category.id,
      name: category.name,
      markers: MARKERS.filter((marker) => marker.category === category.id).map((marker) => ({
        id: marker.id,
        name: marker.name,
        unit: marker.unit,
      })),
    })),
  );
  const latest = useRef(0);

  useEffect(() => {
    setText(queryFromUrl);
  }, [queryFromUrl]);

  useEffect(() => {
    const ticket = latest.current + 1;
    latest.current = ticket;
    const load = async (): Promise<void> => {
      const result = await api<{ categories: CatalogCategory[] }>(
        `/api/markers${queryFromUrl === '' ? '' : `?q=${encodeURIComponent(queryFromUrl)}`}`,
      );
      if (ticket !== latest.current) return;
      if (result.data) setCategories(result.data.categories);
    };
    void load();
  }, [queryFromUrl]);

  const setUrl = (open: string[], query: string): void => {
    const next = new URLSearchParams();
    if (open.length > 0) next.set('open', open.join(','));
    if (query !== '') next.set('q', query);
    const suffix = next.toString();
    navigate(`/markers${suffix === '' ? '' : `?${suffix}`}`);
  };

  useEffect(() => {
    if (text === queryFromUrl) return;
    const timer = window.setTimeout(() => setUrl(openFromUrl, text), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const toggle = (id: string): void => {
    const open = openFromUrl.includes(id)
      ? openFromUrl.filter((entry) => entry !== id)
      : [...openFromUrl, id];
    setUrl(open, queryFromUrl);
  };

  return (
    <>
      <h1 tabIndex={-1}>Marker catalog</h1>
      <div className="field">
        <label htmlFor="field-search">Search markers</label>
        <input
          id="field-search"
          type="search"
          role="searchbox"
          aria-label="Search markers"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      {CATEGORIES.map((category) => {
        const found = categories.find((entry) => entry.id === category.id);
        return (
          <Accordion
            key={category.id}
            name={category.name}
            open={openFromUrl.includes(category.id)}
            onToggle={() => toggle(category.id)}
          >
            {found && found.markers.length > 0 ? (
              <ul>
                {found.markers.map((marker) => (
                  <li key={marker.id}>
                    {marker.name} <span className="muted">{marker.unit}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No markers match that search.</p>
            )}
          </Accordion>
        );
      })}
      <BottomBar>
        <Link to="/plans" className="button">
          See plans
        </Link>
      </BottomBar>
    </>
  );
}

export function JoinScreen(): JSX.Element {
  const { navigate } = useRouter();
  const { signIn } = useSession();
  const { announce } = useAnnounce();
  const errors = useFieldErrors();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    dateOfBirth: '',
    sex: 'female',
    state: 'co',
    timeZone: 'denver',
  });
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    announce(copy.working);
    const result = await api<{ member: { id: string; name: string } }>('/api/accounts', {
      method: 'POST',
      json: form,
    });
    setBusy(false);
    if (result.error) {
      errors.show(result.error);
      announce(result.error.message);
      focusProblems();
      return;
    }
    errors.clear();
    const member = result.data?.member;
    if (member) signIn({ id: member.id, name: member.name, role: 'member' }, '/me');
    announce(copy.accountCreated);
    navigate('/me');
  };

  return (
    <>
      <h1 tabIndex={-1}>Create your free account</h1>
      <Problems fields={errors.fields} message={errors.message} />
      <Card>
        <TextField
          label="Full name"
          name="name"
          value={form.name}
          error={errors.fields.name}
          onChange={(value) => setForm({ ...form, name: value })}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          value={form.email}
          error={errors.fields.email}
          onChange={(value) => setForm({ ...form, email: value })}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          value={form.password}
          error={errors.fields.password}
          onChange={(value) => setForm({ ...form, password: value })}
        />
        <TextField
          label="Date of birth"
          name="dateOfBirth"
          value={form.dateOfBirth}
          error={errors.fields.dateOfBirth}
          onChange={(value) => setForm({ ...form, dateOfBirth: value })}
        />
        <RadioGroup
          label="Sex"
          name="sex"
          value={form.sex}
          error={errors.fields.sex}
          onChange={(value) => setForm({ ...form, sex: value })}
          options={[
            { value: 'female', label: 'Female' },
            { value: 'male', label: 'Male' },
          ]}
        />
        <SelectField
          label="Home state"
          name="state"
          value={form.state}
          error={errors.fields.state}
          onChange={(value) => setForm({ ...form, state: value })}
          options={STATES.map((entry) => ({ value: entry.state, label: entry.name }))}
        />
        <SelectField
          label="Local time"
          name="timeZone"
          value={form.timeZone}
          error={errors.fields.timeZone}
          onChange={(value) => setForm({ ...form, timeZone: value })}
          options={[
            { value: 'newYork', label: 'New York time' },
            { value: 'chicago', label: 'Chicago time' },
            { value: 'denver', label: 'Denver time' },
            { value: 'phoenix', label: 'Phoenix time' },
            { value: 'losAngeles', label: 'Los Angeles time' },
          ]}
        />
      </Card>
      <BottomBar>
        <button type="button" disabled={busy} onClick={() => void submit()}>
          Create account
        </button>
      </BottomBar>
    </>
  );
}

export function SignInScreen(): JSX.Element {
  const { navigate } = useRouter();
  const { signIn } = useSession();
  const { announce, clearSessionEnded, sessionEnded } = useAnnounce();
  const errors = useFieldErrors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    announce(copy.working);
    const result = await api<{ user: { id: string; name: string; role: string }; home: string }>(
      '/api/session',
      { method: 'POST', json: { email, password } },
    );
    setBusy(false);
    if (result.error) {
      errors.show({ code: result.error.code, message: result.error.message });
      announce(result.error.message);
      focusProblems();
      return;
    }
    errors.clear();
    clearSessionEnded();
    const data = result.data;
    if (!data) return;
    signIn({ id: data.user.id, name: data.user.name, role: data.user.role as never }, data.home);
    announce('');
    const resume = window.sessionStorage.getItem('ocotillo:resume');
    window.sessionStorage.removeItem('ocotillo:resume');
    navigate(sessionEnded && resume ? resume : data.home);
  };

  return (
    <>
      <h1 tabIndex={-1}>Sign in</h1>
      <Problems message={errors.message} />
      <Card>
        <TextField
          label="Email"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      </Card>
      <BottomBar>
        <button type="button" disabled={busy} onClick={() => void submit()}>
          Sign in
        </button>
      </BottomBar>
    </>
  );
}

export function NotFoundScreen(): JSX.Element {
  return (
    <>
      <h1 tabIndex={-1}>{copy.notFound}</h1>
      <BottomBar>
        <Link to="/" className="button">
          Go to the home page
        </Link>
      </BottomBar>
    </>
  );
}
