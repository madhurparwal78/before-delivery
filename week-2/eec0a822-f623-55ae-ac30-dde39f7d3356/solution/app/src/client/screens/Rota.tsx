import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { COPY, RULE_TEXT } from "../../shared/copy";
import { formatDay, formatTabDay, formatTime } from "../../shared/format";
import { addDays, localDate, weekday, type Base } from "../../shared/zones";
import { api, sharedCopy } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { followLink, navigate, takeDraft, useDraft } from "../lib/nav";
import { bad, Button, NoteLine, ok, useAction } from "../ui/Controls";
import { Dialog, useDialog } from "../ui/Dialog";
import { NotFoundPage, type Member } from "../ui/Shell";
import { Loader } from "../ui/Visuals";
import { rotaWeekOf } from "./Fleet";

interface RotaView {
  yachtSlug: string;
  weekStart: string;
  base: Base;
  version: number;
  savedBy: string | null;
  savedAt: string | null;
  crew: { id: string; name: string; position: string }[];
  slots: { startsAt: string; date: string; label: string }[];
  work: Record<string, string[]>;
}

type Work = Record<string, string[]>;

interface Cell {
  row: number;
  col: number;
}

export function Rota({ member, slug, week }: { member: Member; slug: string; week: string | null }) {
  const ws = member.workspaceSlug;
  const yacht = useLoad<{ yacht: { name: string; base: Base } }>(`/api/w/${ws}/yachts/${slug}`);
  const base = yacht.data?.yacht.base;
  const weekStart = week && /^\d{4}-\d{2}-\d{2}$/.test(week) && weekday(week) === 6 ? week : base ? rotaWeekOf(localDate(Date.now(), base)) : null;
  const rota = useLoad<RotaView>(weekStart ? `/api/w/${ws}/yachts/${slug}/rota?weekStart=${weekStart}` : null);
  const editor = member.role === "captain" || member.role === "fleet_director";
  const [work, setWork] = useState<Work | null>(null);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [active, setActive] = useState<Cell>({ row: 0, col: 0 });
  const [anchor, setAnchor] = useState<Cell>({ row: 0, col: 0 });
  const action = useAction();
  const discard = useDialog();
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const pointer = useRef("mouse");
  useDraft("rota", work && dirty ? { work, version } : null);

  useEffect(() => {
    if (!rota.data) return;
    const kept = takeDraft<{ work: Work; version: number }>("rota");
    setWork(kept?.work ?? rota.data.work);
    setVersion(kept?.version ?? rota.data.version);
    setDirty(Boolean(kept));
    setDay(rota.data.weekStart);
  }, [rota.data]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (grid && grid.contains(document.activeElement)) {
      grid.querySelector<HTMLElement>(`[data-cell="${active.row}-${active.col}"]`)?.focus();
    }
  }, [active, day]);

  if (yacht.result && !yacht.result.ok && yacht.result.status !== 401) return <NotFoundPage />;
  if (rota.result && !rota.result.ok && rota.result.status === 404) return <NotFoundPage />;
  const r = rota.data;
  const name = yacht.data?.yacht.name;

  const days = weekStart ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [];
  const columns = r && day ? r.slots.filter((s) => s.date === day) : [];
  const rows = r?.crew ?? [];
  const isWork = (crewId: string, start: string) => Boolean(work?.[crewId]?.includes(start));
  const inSelection = (cell: Cell) =>
    cell.row >= Math.min(anchor.row, active.row) && cell.row <= Math.max(anchor.row, active.row)
    && cell.col >= Math.min(anchor.col, active.col) && cell.col <= Math.max(anchor.col, active.col);

  const setCells = (cells: Cell[], toWork: boolean) => {
    if (!work) return;
    const next: Work = { ...work };
    for (const cell of cells) {
      const crewId = rows[cell.row].id;
      const start = columns[cell.col].startsAt;
      const list = new Set(next[crewId] ?? []);
      if (toWork) list.add(start);
      else list.delete(start);
      next[crewId] = [...list].sort();
    }
    setWork(next);
    setDirty(true);
  };

  const toggleActive = () => {
    if (!editor || !columns.length) return;
    const flipTo = !isWork(rows[active.row].id, columns[active.col].startsAt);
    const cells: Cell[] = [];
    for (let row = 0; row < rows.length; row += 1) {
      for (let col = 0; col < columns.length; col += 1) if (inSelection({ row, col })) cells.push({ row, col });
    }
    setCells(cells, flipTo);
  };

  const move = (cell: Cell, extend: boolean) => {
    const next = { row: Math.min(Math.max(0, cell.row), rows.length - 1), col: Math.min(Math.max(0, cell.col), columns.length - 1) };
    setActive(next);
    if (!extend) setAnchor(next);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const keys: Record<string, Cell> = {
      ArrowLeft: { row: active.row, col: active.col - 1 },
      ArrowRight: { row: active.row, col: active.col + 1 },
      ArrowUp: { row: active.row - 1, col: active.col },
      ArrowDown: { row: active.row + 1, col: active.col },
      Home: { row: active.row, col: 0 },
      End: { row: active.row, col: columns.length - 1 },
    };
    if (event.key in keys) {
      event.preventDefault();
      move(keys[event.key], event.shiftKey && event.key.startsWith("Arrow"));
    } else if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      toggleActive();
    }
  };

  const leave = (event: MouseEvent, href: string) => {
    if (dirty) {
      event.preventDefault();
      setLeaveTo(href);
      discard.show(event);
    } else {
      followLink(event, href);
    }
  };

  const saveRota = () =>
    void action.run("Saving rota", async () => {
      const result = await api<RotaView>("PUT", `/api/w/${ws}/yachts/${slug}/rota?weekStart=${weekStart}`, { version, work });
      if (result.ok) {
        setVersion(result.data.version);
        setDirty(false);
        return ok(COPY.rotaSaved);
      }
      const b = result.body;
      if (result.status === 412) {
        const fresh = await api<RotaView>("GET", `/api/w/${ws}/yachts/${slug}/rota?weekStart=${weekStart}`);
        if (fresh.ok) setVersion(fresh.data.version);
        return bad(COPY.staleRota(String(b.savedBy), formatTime(String(b.savedAt), r!.base)));
      }
      if (b.error === "rest_rule") {
        return bad(COPY.restRule(String(b.crewName), RULE_TEXT[String(b.rule)], formatTime(String(b.windowStart), r!.base), formatTime(String(b.windowEnd), r!.base)));
      }
      if (b.errors?.work) return bad(b.errors.work);
      return bad(sharedCopy(result));
    });

  const weekHref = (offset: number) => `/w/${ws}/yachts/${slug}/rota?week=${addDays(weekStart!, offset)}`;

  return (
    <section class="rota">
      <Loader active={!r || !work} />
      {name && weekStart ? (
        <>
          <h1 class="rise">{name} rota</h1>
          <p class="lede">
            Week of <span class="fig">{formatDay(weekStart)}</span>, half-hour slots in {base === "lavrio" ? "Lavrio" : "Split"} time. W is work, R is rest.
          </p>
          <div class="week-links">
            <a class="btn btn--quiet" href={weekHref(-7)} onClick={(e) => leave(e, weekHref(-7))}>Previous week</a>
            <a class="btn btn--quiet" href={weekHref(7)} onClick={(e) => leave(e, weekHref(7))}>Next week</a>
          </div>
        </>
      ) : null}
      {r && work && day ? (
        <>
          <div class="tabs" role="tablist" aria-label="Rota days">
            {days.map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                id={`tab-${d}`}
                aria-selected={d === day ? "true" : "false"}
                aria-controls="rota-panel"
                tabIndex={d === day ? 0 : -1}
                class="tab"
                onClick={() => {
                  setDay(d);
                  move({ row: active.row, col: 0 }, false);
                }}
                onKeyDown={(event) => {
                  const i = days.indexOf(d);
                  const to = event.key === "ArrowRight" ? i + 1 : event.key === "ArrowLeft" ? i - 1 : event.key === "Home" ? 0 : event.key === "End" ? 6 : null;
                  if (to === null) return;
                  event.preventDefault();
                  const target = days[(to + 7) % 7];
                  setDay(target);
                  document.getElementById(`tab-${target}`)?.focus();
                }}
              >
                {formatTabDay(d)}
              </button>
            ))}
          </div>
          <div id="rota-panel" role="tabpanel" aria-labelledby={`tab-${day}`} class="grid-frame">
            <table class="rota-grid" role="grid" aria-label="Rota" ref={gridRef} onKeyDown={onKeyDown}>
              <thead>
                <tr role="row">
                  <th role="columnheader" scope="col" class="rota-grid__corner">Crew</th>
                  {columns.map((s) => (
                    <th key={s.startsAt} role="columnheader" scope="col" class="rota-grid__slot fig">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((c, row) => (
                  <tr key={c.id} role="row">
                    <th role="rowheader" scope="row" class="rota-grid__crew">
                      {c.name}
                      <span class="muted block">{c.position}</span>
                    </th>
                    {columns.map((s, col) => {
                      const on = isWork(c.id, s.startsAt);
                      const here = active.row === row && active.col === col;
                      return (
                        <td
                          key={s.startsAt}
                          role="gridcell"
                          data-cell={`${row}-${col}`}
                          class={`cell${on ? " cell--work" : ""}${here ? " cell--active" : ""}`}
                          tabIndex={here ? 0 : -1}
                          aria-selected={inSelection({ row, col }) ? "true" : "false"}
                          onPointerDown={(event) => (pointer.current = event.pointerType)}
                          onClick={(event) => {
                            const cell = { row, col };
                            if (pointer.current === "touch" || pointer.current === "pen") {
                              move(cell, false);
                              if (editor) setCells([cell], !on);
                            } else {
                              move(cell, event.shiftKey);
                            }
                          }}
                        >
                          {on ? "W" : "R"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editor ? (
            <div class="rota__actions">
              <Button onClick={saveRota} pending={action.pending} pendingLabel="Saving rota">Save rota</Button>
              {r.savedBy && r.savedAt ? <p class="muted">Last saved by {r.savedBy}, <span class="fig">{formatTime(r.savedAt, r.base)}</span>.</p> : null}
            </div>
          ) : null}
          <NoteLine note={action.note} />
        </>
      ) : null}
      <Dialog handle={discard} title="Discard changes">
        <p>This week has cells you have not saved.</p>
        <div class="dialog__actions">
          <Button variant="quiet" onClick={discard.hide}>Keep editing</Button>
          <Button
            variant="danger"
            onClick={() => {
              setDirty(false);
              discard.hide();
              if (leaveTo) navigate(leaveTo);
            }}
          >
            Discard changes
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
