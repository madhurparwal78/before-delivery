import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../store/api';
import { getState } from '../store/state';
import { usernameSyntaxProblem, normalizeUsername, type UsernameReason } from '../../shared/usernames';

/** A tear-off slip pinned under its field. */
export function Slip({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="slip">
      {children}
    </p>
  );
}

const CHIP_COPY: Record<UsernameReason, string> = {
  taken: 'Taken',
  length: 'Use 3 to 32 characters.',
  characters: 'Use only lowercase letters, numbers, underscores and dots.',
  first_character: 'Start with a letter.',
  last_character: "Don't end with a dot.",
};

/**
 * The availability chip for a username field: the syntax reasons show at once, and the exchange is asked only after
 * the debounce, once for the value that stayed.
 */
export function useAvailability(value: string): { chip: string; available: boolean; check: () => Promise<boolean> } {
  const [chip, setChip] = useState('');
  const [available, setAvailable] = useState(false);
  const latest = useRef(value);
  latest.current = value;

  async function ask(name: string): Promise<boolean> {
    const answer = await api<{ available: boolean; reason: UsernameReason | null }>('GET', `/api/usernames/${encodeURIComponent(name)}/availability`);
    if (normalizeUsername(latest.current) === name) {
      setChip(answer.available ? 'Available' : CHIP_COPY[answer.reason!]);
      setAvailable(answer.available);
    }
    return answer.available;
  }

  useEffect(() => {
    const name = normalizeUsername(value);
    setAvailable(false);
    if (name === '') {
      setChip('');
      return;
    }
    const problem = usernameSyntaxProblem(name);
    if (problem) {
      setChip(CHIP_COPY[problem]);
      return;
    }
    setChip('');
    const timer = setTimeout(() => void ask(name).catch(() => setChip('')), getState().config!.timers.availability_debounce_ms);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return { chip, available, check: () => ask(normalizeUsername(value)) };
}

/** The status under a username field, in the tab order after the field. */
export function Chip({ text }: { text: string }) {
  return (
    <p role="status" aria-label="Username availability" tabIndex={0} className={`chip${text === 'Available' ? ' chip--ok' : ''}`}>
      {text}
    </p>
  );
}
