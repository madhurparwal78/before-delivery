import { useRef, useState } from 'react';
import { BILLING_DOWN_GENERAL } from '../../shared/copy';
import { TIER_LABELS, TIER_ORDER, type Membership, type Tier, type User } from '../../shared/types';
import { FormProblems, problemsFrom, type Problems } from '../components/FormProblems';
import { Announcements } from '../components/Shell';
import { api, ApiFailed } from '../lib/api';
import { useApp } from '../lib/app-context';

const PENDING_COPY = 'Payment pending — your membership starts when billing confirms it.';

export function Join(): JSX.Element {
  const { announce, reloadViewer, navigate } = useApp();
  const [tier, setTier] = useState<Tier | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [problems, setProblems] = useState<Problems | null>(null);
  const summary = useRef<HTMLDivElement>(null);
  const fields = useRef<Record<string, HTMLElement | null>>({});
  const radios = useRef<(HTMLDivElement | null)[]>([]);
  const inFlight = useRef(false);

  function jump(field: string): void {
    fields.current[field]?.focus();
  }

  async function submit(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await api.post<{ user: User; membership: Membership }>('/api/members', {
        name,
        email,
        password,
        tier: tier ?? '',
      });
      setProblems(null);
      await reloadViewer();
      navigate('/account', { announce: PENDING_COPY, joinLanding: true });
    } catch (error) {
      if (!(error instanceof ApiFailed)) return;
      if (error.status === 422) {
        const found = problemsFrom(error.fields);
        setProblems(found);
        window.setTimeout(() => summary.current?.focus(), 0);
      } else {
        setProblems(null);
        announce(error.status === 503 ? BILLING_DOWN_GENERAL : error.error);
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  /** Space chooses the focused radio; the arrows move and choose, wrapping. */
  function onTierKeyDown(event: React.KeyboardEvent, index: number): void {
    if (event.key === ' ') {
      event.preventDefault();
      setTier(TIER_ORDER[index] as Tier);
      return;
    }
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward) return;
    event.preventDefault();
    const next = (index + (forward ? 1 : -1) + TIER_ORDER.length) % TIER_ORDER.length;
    setTier(TIER_ORDER[next] as Tier);
    radios.current[next]?.focus();
  }

  return (
    <>
      <Announcements kind="account" />
      <h1>Join Pegworth</h1>
      <FormProblems problems={problems} ref={summary} onJump={jump} />
      <form
        className="ledger-form join-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div
          role="radiogroup"
          aria-label="Membership tier"
          className="tier-group"
          ref={(element) => {
            fields.current.tier = element;
          }}
          tabIndex={-1}
        >
          {TIER_ORDER.map((candidate, index) => (
            <div
              key={candidate}
              role="radio"
              aria-label={TIER_LABELS[candidate]}
              aria-checked={tier === candidate}
              className="tier-radio"
              ref={(element) => {
                radios.current[index] = element;
              }}
              tabIndex={tier === null ? (index === 0 ? 0 : -1) : tier === candidate ? 0 : -1}
              onKeyDown={(event) => onTierKeyDown(event, index)}
              onClick={() => setTier(candidate)}
            >
              <span className="tier-mark" aria-hidden="true" />
              {TIER_LABELS[candidate]}
            </div>
          ))}
        </div>

        <label>
          Name
          <input
            aria-label="Name"
            value={name}
            ref={(element) => {
              fields.current.name = element;
            }}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Email
          <input
            aria-label="Email"
            value={email}
            ref={(element) => {
              fields.current.email = element;
            }}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            aria-label="Password"
            value={password}
            ref={(element) => {
              fields.current.password = element;
            }}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" aria-busy={pending} aria-disabled={pending}>
          {pending ? 'Starting your membership...' : 'Pay and join'}
        </button>
      </form>
    </>
  );
}
