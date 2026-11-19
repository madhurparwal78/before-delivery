import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { announce } from '../announce';
import { useConfig, useNow } from '../clock';
import { plural, relativeTime } from '../format';
import type { PersonCard } from '../types';
import { Alert, Button, Dialog } from '../ui';

const COLUMNS = ['Name', 'Headline', 'Sent', 'Action'] as const;
const ACTION = COLUMNS.indexOf('Action');

interface SentGridProps {
  rows: PersonCard[];
  /** Drops withdrawn members from the page's list at once. */
  onWithdrawn: (ids: string[]) => void;
  /** Reads the network again (after a refusal). */
  reload: () => void;
}

interface TabStop {
  memberId: string;
  column: number;
}

const cellSelector = (memberId: string, column: number): string => `[data-member-id="${memberId}"] [data-column="${column}"]`;

/** The sent invitations as a keyboard grid: select rows, withdraw one or many, all or nothing. */
export function SentGrid({ rows, onWithdrawn, reload }: SentGridProps) {
  const config = useConfig();
  const now = useNow();
  const grid = useRef<HTMLDivElement>(null);
  const selectedButton = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [tabStop, setTabStop] = useState<TabStop | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmIds, setConfirmIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const focusAfter = useRef<string | 'heading' | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const chosen = rows.filter((row) => selected.has(row.id));
  const stop: TabStop = tabStop && ids.includes(tabStop.memberId) ? tabStop : { memberId: ids[0] ?? '', column: 0 };

  useEffect(() => {
    if (focusRequest === 0 || focusAfter.current === null) return;
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === 'heading') document.getElementById('sent-invitations-heading')?.focus();
    else grid.current?.querySelector<HTMLElement>(cellSelector(target, 0))?.focus();
  }, [focusRequest]);

  /** Where focus goes once rows leave: the row now at the first withdrawn position, else the last row, else the heading. */
  const focusTargetWithout = (withdrawn: string[]): string | 'heading' => {
    const first = ids.findIndex((id) => withdrawn.includes(id));
    const remaining = ids.filter((id) => !withdrawn.includes(id));
    return remaining[first] ?? remaining[remaining.length - 1] ?? 'heading';
  };

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]');
    if (!cell || cell !== event.target) return;
    const memberId = cell.closest<HTMLElement>('[data-member-id]')?.dataset.memberId ?? '';
    const column = Number(cell.dataset.column);
    const row = ids.indexOf(memberId);
    const go = (nextRow: number, nextColumn: number): void => {
      event.preventDefault();
      const target = ids[Math.min(ids.length - 1, Math.max(0, nextRow))] ?? memberId;
      grid.current?.querySelector<HTMLElement>(cellSelector(target, Math.min(COLUMNS.length - 1, Math.max(0, nextColumn))))?.focus();
    };
    if (event.key === 'ArrowDown') go(row + 1, column);
    else if (event.key === 'ArrowUp') go(row - 1, column);
    else if (event.key === 'ArrowRight') go(row, column + 1);
    else if (event.key === 'ArrowLeft') go(row, column - 1);
    else if (event.key === 'Home' && event.ctrlKey) go(0, 0);
    else if (event.key === 'End' && event.ctrlKey) go(ids.length - 1, COLUMNS.length - 1);
    else if (event.key === 'Home') go(row, 0);
    else if (event.key === 'End') go(row, COLUMNS.length - 1);
    else if (event.key === ' ' && column !== ACTION) {
      event.preventDefault();
      setSelected((current) => {
        const next = new Set(current);
        if (!next.delete(memberId)) next.add(memberId);
        return next;
      });
    } else if (event.key === 'Enter' && column === ACTION) {
      event.preventDefault();
      cell.querySelector<HTMLButtonElement>('button')?.click();
    } else if (event.key === 'Enter' && column === 0) {
      event.preventDefault();
      cell.querySelector<HTMLAnchorElement>('a')?.click();
    }
  };

  const withdrawOne = async (card: PersonCard): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      await api.post(`/api/connections/${card.id}/withdraw`);
      focusAfter.current = focusTargetWithout([card.id]);
      onWithdrawn([card.id]);
      setFocusRequest((n) => n + 1);
      announce('Network announcements', 'Invitation withdrawn.');
    } catch {
      announce('Network announcements', 'Invitation not sent.');
      setProblem('Something went wrong. Try again.');
      reload();
    } finally {
      setBusy(false);
    }
  };

  const withdrawChosen = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    const memberIds = confirmIds;
    try {
      await api.post('/api/invitations/withdraw', { member_ids: memberIds });
      focusAfter.current = focusTargetWithout(memberIds);
      setSelected(new Set());
      onWithdrawn(memberIds);
      setConfirming(false);
      announce('Network announcements', `Withdrew ${plural(memberIds.length, 'invitation')}.`);
    } catch (error) {
      setConfirming(false);
      if (error instanceof ApiError && error.status === 409 && error.body.error === 'not_pending') {
        const name = rows.find((row) => row.id === error.body.member_id)?.name ?? 'This member';
        setProblem(`${name}'s invitation is no longer pending. Nothing was withdrawn.`);
      } else {
        setProblem('Something went wrong. Try again.');
      }
      reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sent">
      <div className="sent-actions">
        <Button
          ref={selectedButton}
          disabled={chosen.length === 0}
          onClick={() => {
            setConfirmIds(chosen.map((row) => row.id));
            setConfirming(true);
          }}
        >
          Withdraw selected ({chosen.length})
        </Button>
      </div>
      <Alert>{problem}</Alert>
      <div ref={grid} role="grid" aria-label="Sent invitations" className="grid" onKeyDown={move}>
        <div role="row" className="grid-row grid-head">
          {COLUMNS.map((column) => (
            <div key={column} role="columnheader" className="muted">
              {column}
            </div>
          ))}
        </div>
        {rows.map((card) => {
          const isSelected = selected.has(card.id);
          return (
            <div key={card.id} role="row" aria-selected={isSelected} data-member-id={card.id} className="grid-row surface">
              {[
                <Link key="name" tabIndex={-1} to={`/in/${card.handle}`} className="grid-name">
                  {card.name}
                </Link>,
                card.headline,
                card.requested_at ? relativeTime(card.requested_at, now, config.time_zone) : '',
                <Button key="action" tabIndex={-1} aria-label={`Withdraw request to ${card.name}`} disabled={busy} onClick={() => void withdrawOne(card)}>
                  Withdraw
                </Button>,
              ].map((content, column) => (
                <div
                  key={COLUMNS[column]}
                  role="gridcell"
                  data-column={column}
                  tabIndex={stop.memberId === card.id && stop.column === column ? 0 : -1}
                  onFocus={(event) => event.target === event.currentTarget && setTabStop({ memberId: card.id, column })}
                  className={`grid-cell grid-cell-${COLUMNS[column]?.toLowerCase()}`}
                >
                  <span className="grid-label muted" aria-hidden="true">
                    {COLUMNS[column]}
                  </span>
                  {content}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <Dialog
        name={`Withdraw ${plural(confirmIds.length, 'invitation')}?`}
        open={confirming}
        onClose={() => setConfirming(false)}
        returnFocus={() => {
          const target = focusAfter.current;
          focusAfter.current = null;
          if (target === 'heading') return document.getElementById('sent-invitations-heading');
          if (target) return grid.current?.querySelector<HTMLElement>(cellSelector(target, 0)) ?? selectedButton.current;
          return selectedButton.current;
        }}
      >
        <p className="t-heading">Withdraw {plural(confirmIds.length, 'invitation')}?</p>
        <div className="dialog-actions">
          <Button disabled={busy} onClick={() => void withdrawChosen()}>
            Withdraw
          </Button>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      </Dialog>
    </div>
  );
}
