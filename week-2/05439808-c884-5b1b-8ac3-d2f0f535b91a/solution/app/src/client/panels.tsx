// The Raid log, Rewards, League and Profile panels.
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import type { Amounts, League } from '../shared/catalog';
import { api, type ApiFailure } from './api';
import { amountsText, fmt, localDateTime } from './copy';
import { useSecondTick } from './chrome';
import { Panel } from './panel';
import { ZoneSelect } from './public';
import { loadRaids, loadRewards, loadVillage, navigate, serverNow, update, type RaidLists } from './store';
import type { Me, RaidRow } from './types';
import { Button, Empty, Field, invalid, perform, useBusy, useStore, type FieldErrors } from './ui';

/** Accessible tabs: arrow keys move between them, the selected one owns the panel below. */
export function Tabs<T extends string>({ id, tabs, value, onChange }: { id: string; tabs: readonly { key: T; label: string }[]; value: T; onChange: (key: T) => void }) {
  return (
    <div class="tabs" role="tablist">
      {tabs.map((t, i) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          id={`${id}-tab-${t.key}`}
          class="tab"
          aria-selected={value === t.key ? 'true' : 'false'}
          aria-controls={`${id}-panel`}
          tabIndex={value === t.key ? 0 : -1}
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => {
            const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!step) return;
            e.preventDefault();
            const next = tabs[(i + step + tabs.length) % tabs.length] as { key: T };
            onChange(next.key);
            document.getElementById(`${id}-tab-${next.key}`)?.focus();
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const RAID_TABS = [
  { key: 'attack', label: 'Attacks' },
  { key: 'defence', label: 'Defences' },
] as const;

function RaidRowView({ row, zone }: { row: RaidRow; zone: string }) {
  const when = localDateTime(row.resolvedAt ?? row.lockedAt, zone);
  if (row.state === 'resolved') {
    const replay = `/raids/${row.id}/replay`;
    return (
      <li>
        <span>
          <span class="num">{row.stars}</span> stars · <span class="num danger-text">{row.destruction}%</span> ·{' '}
          <span class="num">{amountsText(row.transferred ?? { brine: 0, peat: 0, copper: 0 })}</span> · <span class="num">{when}</span>
        </span>
        <Button onClick={() => navigate(replay)}>{row.role === 'attack' ? `Replay raid on ${row.opponent.displayName}` : `Replay raid by ${row.opponent.displayName}`}</Button>
      </li>
    );
  }
  return (
    <li>
      <span>
        {row.state === 'abandoned' ? 'Abandoned' : 'Under way'} · <span class="num">{when}</span>
      </span>
      <span class="hint">{row.role === 'attack' ? `On ${row.opponent.displayName}` : `By ${row.opponent.displayName}`}</span>
    </li>
  );
}

export function RaidLogPanel() {
  const s = useStore();
  const [tab, setTab] = useState<keyof RaidLists>('attack');
  const [loading, setLoading] = useState(true);
  useLayoutEffect(() => {
    void perform({ pending: 'Loading raids…', run: loadRaids }).finally(() => setLoading(false));
  }, []);
  const rows = s.raids?.[tab] ?? [];
  const zone = s.me?.timeZone ?? 'UTC';
  return (
    <Panel label="Raid log" title="Raid log">
      <Tabs id="raidlog" tabs={RAID_TABS} value={tab} onChange={setTab} />
      <div id="raidlog-panel" role="tabpanel" aria-labelledby={`raidlog-tab-${tab}`}>
        {loading && !s.raids ? (
          <>
            <div class="skeleton" />
            <div class="skeleton" />
          </>
        ) : rows.length === 0 ? (
          <section>
            <Empty>{tab === 'attack' ? 'No raids yet. Scout an island from Raid.' : 'No one has raided your island yet.'}</Empty>
          </section>
        ) : (
          <ul class="list">
            {rows.map((row) => (
              <RaidRowView key={row.id} row={row} zone={zone} />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

export function RewardsPanel() {
  const s = useStore();
  useSecondTick();
  const [opening, open] = useBusy();
  const [claiming, claim] = useBusy();
  useEffect(() => {
    void loadRewards().catch(() => undefined);
  }, []);
  const r = s.rewards;
  const zone = r?.timeZone ?? s.me?.timeZone ?? 'UTC';
  const now = serverNow();
  const ready = (next: string | null): boolean => next === null || Date.parse(next) <= now;
  const after = (): void => {
    void loadRewards().catch(() => undefined);
    void loadVillage().catch(() => undefined);
  };
  const nextAt = (f: ApiFailure): string => localDateTime(f.body?.nextClaimAt ?? now, zone);
  return (
    <Panel label="Rewards" title="Rewards">
      {!r ? (
        <div class="skeleton" />
      ) : (
        <>
          <section>
            <h3>Daily chest</h3>
            <p>{ready(r.daily.nextClaimAt) ? 'Chest ready to open' : <>Next chest <span class="num">{localDateTime(r.daily.nextClaimAt as string, zone)}</span></>}</p>
            <p>
              Streak day <span class="num">{r.daily.streak}</span> of 7
            </p>
            <p>
              Next chest holds <span class="num">{amountsText(r.daily.chest)}</span>
            </p>
            <Button
              variant="primary"
              busy={opening}
              onClick={() =>
                void open({
                  pending: 'Opening…',
                  run: () => api.post<{ credited: Amounts; streak: number }>('/api/me/rewards/daily'),
                  success: (x) => `Daily chest opened (day ${x.streak} of 7): ${amountsText(x.credited)}.`,
                  errors: { already_claimed: (f) => `Next chest at ${nextAt(f)}.` },
                }).then(after)
              }
            >
              Open daily chest
            </Button>
          </section>
          <section>
            <h3>{r.weekly.league} league bonus</h3>
            <p>{ready(r.weekly.nextClaimAt) ? 'League bonus ready to claim' : <>Next league bonus <span class="num">{localDateTime(r.weekly.nextClaimAt as string, zone)}</span></>}</p>
            <p class="hint">
              Pays <span class="num">{amountsText(r.weekly.bonus)}</span> each local week from Monday 00:00.
            </p>
            <Button
              variant="primary"
              busy={claiming}
              onClick={() =>
                void claim({
                  pending: 'Claiming…',
                  run: () => api.post<{ credited: Amounts; league: League }>('/api/me/rewards/weekly'),
                  success: (x) => `${x.league} league bonus claimed: ${amountsText(x.credited)}.`,
                  errors: { already_claimed: (f) => `Next league bonus at ${nextAt(f)}.` },
                }).then(after)
              }
            >
              Claim league bonus
            </Button>
          </section>
          <section>
            <p>
              Star bonuses today <span class="num">{r.starBonus.used}</span>/<span class="num">{r.starBonus.cap}</span>
            </p>
            <p class="hint">Times are in {zone}.</p>
          </section>
        </>
      )}
    </Panel>
  );
}

interface Standing {
  rank: number;
  id: number;
  name: string;
  trophies: number;
  memberCount: number;
}

export function LeaguePanel() {
  const s = useStore();
  const [clans, setClans] = useState<Standing[] | null>(null);
  useEffect(() => {
    const load = (): void => {
      if (document.hidden) return;
      void api.get<{ clans: Standing[] }>('/api/league/clans').then((r) => setClans(r.clans)).catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 1000);
    return () => clearInterval(timer);
  }, []);
  const mine = s.me?.clanId ?? null;
  return (
    <Panel label="League" title="League">
      {!clans ? (
        <div class="skeleton" />
      ) : clans.length === 0 ? (
        <section>
          <Empty>No clans on the tide yet.</Empty>
        </section>
      ) : (
        <section>
          <table aria-label="Clan standings">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Clan</th>
                <th scope="col">Trophies</th>
                <th scope="col">Members</th>
              </tr>
            </thead>
            <tbody>
              {clans.map((c) => (
                <tr key={c.id} class={c.id === mine ? 'mine' : undefined}>
                  <td class="num">{c.rank}</td>
                  <td>{c.name}</td>
                  <td class="num">{fmt(c.trophies)}</td>
                  <td class="num">{c.memberCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </Panel>
  );
}

export function ProfilePanel() {
  const s = useStore();
  const [displayName, setDisplayName] = useState(s.me?.displayName ?? '');
  const [timeZone, setTimeZone] = useState(s.me?.timeZone ?? 'UTC');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, run] = useBusy();
  const submit = (e: Event): void => {
    e.preventDefault();
    void run({
      pending: 'Saving…',
      run: () => api.patch<Me>('/api/me', { displayName, timeZone }),
      success: () => 'Profile saved.',
      fields: setErrors,
    }).then((me) => {
      if (me) update({ me });
    });
  };
  return (
    <Panel label="Profile" title="Profile">
      <form onSubmit={submit} noValidate>
        <section>
          <Field id="pf-name" label="Display name" error={errors.displayName}>
            <input id="pf-name" type="text" value={displayName} onInput={(e) => setDisplayName(e.currentTarget.value)} {...invalid('pf-name', errors.displayName)} />
          </Field>
          <ZoneSelect id="pf-zone" value={timeZone} error={errors.timeZone} onChange={setTimeZone} />
          <p class="hint">{s.me?.email}</p>
          <Button type="submit" variant="primary" busy={busy}>
            Save profile
          </Button>
        </section>
      </form>
    </Panel>
  );
}
