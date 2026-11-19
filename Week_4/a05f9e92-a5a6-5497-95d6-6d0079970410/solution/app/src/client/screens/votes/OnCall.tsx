import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PageJson, Rotation } from "../../../server/oncall.js";
import { useAnnounce } from "../../lib/announce.js";
import { failureText, get, post } from "../../lib/api.js";
import { useTopics } from "../../lib/live.js";
import { useSession } from "../../lib/session.js";
import { Button, Page, Rest, StatusBlock, loadingScreen, useLoad, useViewport } from "../../lib/ui.js";
import { pressFeedback } from "./gesture.js";
import { OverrideDialog, type Person } from "./OverrideDialog.js";
import { PageCard, PageSheet } from "./PageCard.js";
import { formatLocalIso } from "../../../shared/tz.js";
import { useUndoQueue } from "./undo.js";

interface ShiftJson {
  username: string;
  start: string;
  end: string;
  override: boolean;
}

interface OnCallNow {
  username: string;
  shift_start: string;
  shift_end: string;
  override: boolean;
}

interface RotationView {
  rotation: Rotation;
  now: OnCallNow;
  shifts: ShiftJson[];
}

interface Loaded {
  pages: PageJson[];
  people: Person[];
  rotations: RotationView[];
}

interface Swiped {
  key: string;
  page: PageJson;
}

const EIGHT_WEEKS_MS = 56 * 86_400_000;

async function load(): Promise<Loaded> {
  const [pages, users, rotations] = await Promise.all([get<{ pages: PageJson[] }>("/api/pages"), get<{ users: Person[] }>("/api/users"), get<{ rotations: Rotation[] }>("/api/rotations")]);
  const from = new Date();
  const to = new Date(from.getTime() + EIGHT_WEEKS_MS);
  const views = await Promise.all(
    rotations.rotations.map(async (rotation): Promise<RotationView> => {
      const path = `/api/rotations/${encodeURIComponent(rotation.name)}`;
      const [now, shifts] = await Promise.all([get<OnCallNow>(`${path}/oncall?at=${encodeURIComponent(from.toISOString())}`), get<{ shifts: ShiftJson[] }>(`${path}/shifts?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)]);
      return { rotation, now, shifts: shifts.shifts };
    }),
  );
  return { pages: pages.pages, people: users.users.filter((person) => person.active), rotations: views };
}

/**
 * On call (`/desk/oncall`) and Pages (`/pages`): who answers now, the shifts of the next eight weeks, overrides and the
 * open pages. `/pages` puts the pages first, which is what a technician on a phone opens.
 */
export function OnCallScreen({ pagesFirst }: { pagesFirst: boolean }): JSX.Element {
  const session = useSession();
  const announce = useAnnounce();
  const phone = useViewport() === "phone";
  const zone = session.user?.time_zone ?? "UTC";
  const { state, reload, setData } = useLoad(load, [session.accessVersion]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [sheet, setSheet] = useState<PageJson | null>(null);
  const [adding, setAdding] = useState(false);
  const [kept, setKept] = useState<ReadonlySet<number>>(new Set());
  const dataRef = useRef<Loaded | null>(null);
  const focusKey = useRef<number | null>(null);
  dataRef.current = state.status === "ready" ? state.data : null;

  const acknowledge = useCallback(
    async (page: PageJson): Promise<void> => {
      setErrors((previous) => ({ ...previous, [page.id]: "" }));
      try {
        const { page: updated } = await post<{ page: PageJson }>(`/api/pages/${page.id}/acknowledge`, {});
        announce("Page acknowledged.");
        setKept((previous) => new Set(previous).add(page.id));
        const current = dataRef.current;
        if (current) setData({ ...current, pages: current.pages.map((entry) => (entry.id === updated.id ? updated : entry)) });
      } catch (error) {
        const message = failureText(error);
        setErrors((previous) => ({ ...previous, [page.id]: message }));
        announce(message);
      }
    },
    [announce, setData],
  );

  const swiped = useUndoQueue<Swiped>((entry) => acknowledge(entry.page));
  const hiddenIds = new Set(swiped.held.map((entry) => entry.value.page.id));
  const waiting = swiped.held.filter((entry) => !entry.sent);

  const press = async (page: PageJson): Promise<void> => {
    setBusy(page.id);
    await acknowledge(page);
    setBusy(null);
  };

  useTopics(["list:page"], () => reload());

  useEffect(() => {
    if (focusKey.current === null) return;
    const node = document.querySelector<HTMLElement>(`[data-card="${focusKey.current}"]`);
    if (!node) return;
    node.focus();
    focusKey.current = null;
  });

  const loading = loadingScreen(state, "On call", reload);
  if (loading) return loading;
  if (state.status !== "ready") return <></>;

  const { pages, people, rotations } = state.data;
  const names = new Map(people.map((person) => [person.username, person.display_name]));
  const who = (username: string): string => names.get(username) ?? username;
  const open = pages.filter((page) => (page.status !== "acknowledged" || kept.has(page.id)) && !hiddenIds.has(page.id));

  const pagesSection = (
    <Rest key="pages" label="Open pages" className="oncall-section">
      <h2>Open pages</h2>
      {waiting.map(({ value }) => (
        <div className="undo-bar" key={value.key}>
          <p>{`Acknowledging ${value.page.record}`}</p>
          <Button
            onClick={() => {
              swiped.undo(value.key);
              focusKey.current = value.page.id;
            }}
          >
            Undo
          </Button>
        </div>
      ))}
      {open.length === 0 && swiped.held.length === 0 ? (
        <p className="muted">No open pages.</p>
      ) : (
        <div className="page-grid">
          {open.map((page) => (
            <PageCard
              key={page.id}
              page={page}
              names={names}
              zone={zone}
              phone={phone}
              error={errors[page.id]}
              busy={busy === page.id}
              onAcknowledge={() => void press(page)}
              onSwipe={() => swiped.hold({ key: String(page.id), page })}
              onSheet={() => setSheet(page)}
            />
          ))}
        </div>
      )}
      {phone && open.some((page) => page.status !== "acknowledged") ? <p className="muted vote-hint">Swipe right to acknowledge, or hold a card for more.</p> : null}
    </Rest>
  );

  const nowSection = (
    <Rest key="now" label="On call now" className="oncall-section">
      <div className="section-head">
        <h2>On call now</h2>
        {session.isOperator && rotations.length > 0 ? <Button onClick={() => setAdding(true)}>Add override</Button> : null}
      </div>
      {rotations.length === 0 ? <p className="muted">No rotations are set up.</p> : null}
      <ul className="now-list">
        {rotations.map(({ rotation, now }) => (
          <li key={rotation.name} className="now-item">
            <p className="now-rotation">{rotation.name}</p>
            <p className="now-person">{who(now.username)}</p>
            <p className="muted">
              {formatLocalIso(now.shift_start, zone)} to {formatLocalIso(now.shift_end, zone)}
            </p>
            {now.override ? <StatusBlock>Override</StatusBlock> : null}
          </li>
        ))}
      </ul>
    </Rest>
  );

  const shiftsSection = (
    <Rest key="shifts" label="Shifts" className="oncall-section">
      <h2>Shifts, next eight weeks</h2>
      {rotations.map(({ rotation, shifts }) => (
        <ShiftTable key={rotation.name} title={rotation.name} shifts={shifts.filter((shift) => !shift.override)} who={who} zone={zone} />
      ))}
    </Rest>
  );

  const overridesSection = (
    <Rest key="overrides" label="Overrides" className="oncall-section">
      <h2>Overrides</h2>
      {rotations.every(({ shifts }) => !shifts.some((shift) => shift.override)) ? <p className="muted">No overrides in the next eight weeks.</p> : null}
      {rotations.map(({ rotation, shifts }) => {
        const overrides = shifts.filter((shift) => shift.override);
        return overrides.length === 0 ? null : <ShiftTable key={rotation.name} title={rotation.name} shifts={overrides} who={who} zone={zone} />;
      })}
    </Rest>
  );

  const sections: ReactNode[] = pagesFirst ? [pagesSection, nowSection, shiftsSection, overridesSection] : [nowSection, shiftsSection, overridesSection, pagesSection];

  return (
    <Page subject="On call" wide>
      <div className="oncall-body" onPointerDown={pressFeedback}>
        {sections}
      </div>
      {sheet ? <PageSheet page={sheet} onClose={() => setSheet(null)} onAcknowledge={() => void press(sheet)} /> : null}
      {adding ? <OverrideDialog rotations={rotations.map((entry) => entry.rotation)} people={people} onClose={() => setAdding(false)} onSaved={reload} /> : null}
    </Page>
  );
}

function ShiftTable({ title, shifts, who, zone }: { title: string; shifts: ShiftJson[]; who(username: string): string; zone: string }): JSX.Element {
  return (
    <table className="shift-table">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">Person</th>
          <th scope="col">From</th>
          <th scope="col">To</th>
        </tr>
      </thead>
      <tbody>
        {shifts.map((shift) => (
          <tr key={`${shift.start}-${shift.override}-${shift.username}`}>
            <td>{who(shift.username)}</td>
            <td>{formatLocalIso(shift.start, zone)}</td>
            <td>{formatLocalIso(shift.end, zone)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
