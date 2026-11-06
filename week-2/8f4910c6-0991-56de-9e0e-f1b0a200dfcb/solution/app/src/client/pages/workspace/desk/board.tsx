// The availability board (/workspace/board?office=&talent=): a 14-day strip of option ladders for one talent.
// Signature motion: a leaving chip fades (short), the chips below slide up their rungs (middle), the promoted
// numeral rolls (long), a booked day fills ink (short). Attributes, names and announcements change at once.

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../../../api.js";
import { Link, definePage, navigate, useLocation } from "../../../router.js";
import { DRAFT_RESTORED_COPY, takeDraft } from "../../../session.js";
import { Shell } from "../../../workspace/shell.js";
import { StatusLine, useAnnouncer } from "../../../ui/status.js";
import { prefersReducedMotion } from "../../../ui/media.js";
import { dayLabel, formatDate, formatOfficeTime, ordinal } from "../../../../shared/format.js";
import { OFFICES, OFFICE_IDS, isOfficeId, type OfficeId } from "../../../../shared/zones.js";
import { ConfirmDialog, DayDialog, type DayValues } from "./board-dialogs.js";
import { here, isLive, useOfficeToday, type ClientSummary, type Ladder, type LadderDay, type OptionRecord, type TalentSummary } from "./common.js";
import { useResource, useMember } from "../../../workspace/data.js";

const STRIP_DAYS = 14;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const SWEEP_REASONS = ["hold_expired", "auto_release", "challenge_timeout"];

interface Leaving {
  option: OptionRecord;
  rung: number;
}

/** The chip states the brief publishes for API states. */
function chipState(option: OptionRecord): string {
  return option.state === "placed" ? "option" : option.state === "confirmed" ? "booked" : option.state;
}

function Numeral({ rank, rollFrom }: { rank: number; rollFrom?: number }) {
  const ghosts = rollFrom && rollFrom > rank ? Array.from({ length: rollFrom - rank }, (_, i) => rank + i + 1) : [];
  return (
    <span className="numeral-box">
      <span className="numeral-strip" data-roll={ghosts.length || undefined}>
        <span>{ordinal(rank)}</span>
        {ghosts.map((ghost) => <span key={ghost} aria-hidden="true">{ordinal(ghost)}</span>)}
      </span>
    </span>
  );
}

function Chip({ option, rollFrom }: { option: OptionRecord; rollFrom?: number }) {
  const rank = option.rank ?? 1;
  return (
    <span className="chip" data-rank={rank} data-state={chipState(option)} data-option={option.id}
      style={{ gridRow: rank }}>
      <span className="chip-rank"><Numeral rank={rank} rollFrom={rollFrom} /></span>{" "}
      <span className="chip-company">{option.clientCompany}</span>
      {option.state === "challenged" ? <>{" "}<span className="chip-note">Challenged</span></> : null}
    </span>
  );
}

function DayButton({ day, leaving, rolls, focusable, onKey, onOpen, onLeft, buttonRef }: {
  day: LadderDay;
  leaving: Leaving[];
  rolls: Record<string, number>;
  focusable: boolean;
  onKey: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onOpen: () => void;
  onLeft: (optionId: string) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}) {
  const booked = day.options.find((option) => option.state === "confirmed");
  const live = day.options.filter(isLive).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  return (
    <button ref={buttonRef} type="button" className="day" data-day-state={day.dayState} tabIndex={focusable ? 0 : -1}
      onKeyDown={onKey} onClick={onOpen}>
      <span className="day-label">{dayLabel(day.date)}</span>{" "}
      <span className="rungs">
        {booked ? (
          <span className="chip" data-rank="1" data-state="booked" data-option={booked.id}>
            <span className="chip-rank">Booked</span>{" "}<span className="chip-company">{booked.clientCompany}</span>
          </span>
        ) : live.length ? (
          live.map((option, i) => (
            <Fragment key={option.id}>{i ? " " : null}<Chip option={option} rollFrom={rolls[option.id]} /></Fragment>
          ))
        ) : (
          <span className="day-open">Open</span>
        )}
        {leaving.map(({ option, rung }) => (
          <span key={`leaving-${option.id}`} className="chip leaving" data-rank={rung} data-state="released"
            aria-hidden="true" style={{ gridRow: rung }} onAnimationEnd={() => onLeft(option.id)}>
            <span className="chip-rank">{ordinal(rung)}</span> <span className="chip-company">{option.clientCompany}</span>
          </span>
        ))}
      </span>
    </button>
  );
}

interface DialogState {
  date: string;
  values?: DayValues;
}

function BoardPage() {
  const member = useMember();
  const { query } = useLocation();
  const officeParam = query.get("office") ?? "";
  const office: OfficeId = isOfficeId(officeParam) ? officeParam : member.office;
  const slug = query.get("talent") ?? "";
  const { message, announce } = useAnnouncer();
  const roster = useResource<{ talent: TalentSummary[] }>(`/api/talent?office=${office}&state=active`);
  const clients = useResource<{ clients: ClientSummary[] }>("/api/clients");
  const list = useMemo(() => [...(roster.data?.talent ?? [])]
    .sort((a, b) => a.displayName.localeCompare(b.displayName)), [roster.data]);
  const talent = list.find((t) => t.slug === slug) ?? null;
  const today = useOfficeToday(office);
  const ladderPath = talent && today ? `/api/talent/${talent.id}/ladder?from=${today}&days=${STRIP_DAYS}` : null;
  const [ladder, setLadder] = useState<Ladder | null>(null);
  const [leaving, setLeaving] = useState<Record<string, Leaving[]>>({});
  const [rolls, setRolls] = useState<Record<string, number>>({});
  const [focusIndex, setFocusIndex] = useState(0);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [confirming, setConfirming] = useState<OptionRecord | null>(null);
  const [references, setReferences] = useState<Record<string, string>>({});
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const strip = useRef<HTMLDivElement>(null);
  const offsets = useRef<Record<string, number>>({});
  const leftAt = useRef(0);
  const ladderRef = useRef<Ladder | null>(null);
  const focusAfter = useRef<(() => HTMLElement | null) | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    if (!slug && list.length) {
      navigate(`/workspace/board?office=${office}&talent=${list[0].slug}`, { replace: true });
    }
  }, [slug, list, office]);

  /** Applies a fresh ladder: works out leaving chips, numeral rolls and sweep releases against the last one. */
  const apply = useCallback((next: Ladder) => {
    const before = ladderRef.current;
    ladderRef.current = next;
    if (before && before.talentId === next.talentId) {
      const quiet = prefersReducedMotion();
      const exits: Record<string, Leaving[]> = {};
      const rolled: Record<string, number> = {};
      for (const day of next.days) {
        const old = before.days.find((d) => d.date === day.date);
        if (!old) continue;
        for (const was of old.options.filter(isLive)) {
          const now = day.options.find((o) => o.id === was.id);
          if (now && isLive(now)) {
            if (!quiet && now.rank && was.rank && now.rank < was.rank) rolled[now.id] = was.rank;
            continue;
          }
          if (!quiet && was.rank && now?.state !== "confirmed") (exits[day.date] ??= []).push({ option: was, rung: was.rank });
          if (now && now.releasedAt && now.releaseReason && SWEEP_REASONS.includes(now.releaseReason)) {
            announce(`${now.clientCompany}'s option on ${formatDate(now.date)} was released at ${
              formatOfficeTime(now.releasedAt, next.office)}.`);
          }
        }
      }
      if (Object.keys(exits).length) {
        leftAt.current = performance.now();
        setLeaving(exits);
      }
      setRolls(rolled);
    }
    setLadder(next);
  }, [announce]);

  const reload = useCallback(async () => {
    if (!ladderPath) return;
    const result = await api<Ladder>("GET", ladderPath);
    if (result.ok && ladderPath.includes(result.data.talentId)) apply(result.data);
  }, [ladderPath, apply]);

  useEffect(() => {
    ladderRef.current = null;
    setLadder(null);
    offsets.current = {};
    void reload();
    const timer = setInterval(() => void reload(), 4000);
    return () => clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    for (const day of ladder?.days ?? []) {
      const id = day.bookingId;
      if (id && !references[id]) {
        void api<{ booking: { reference: string } }>("GET", `/api/bookings/${id}`).then((result) => {
          if (result.ok) setReferences((known) => ({ ...known, [id]: result.data.booking.reference }));
        });
      }
    }
  }, [ladder, references]);

  // A draft kept when the session ended mid-dialog reopens that dialog with its values.
  useEffect(() => {
    if (restored.current || !ladder) return;
    restored.current = true;
    const draft = takeDraft(here());
    if (draft?.dialog === "day" && draft.values.date) {
      setDialog({ date: draft.values.date, values: {
        client: draft.values.client ?? "", jobTitle: draft.values.jobTitle ?? "", note: draft.values.note ?? "",
        holdUntil: draft.values.holdUntil ?? "" } });
      announce(DRAFT_RESTORED_COPY);
    }
  }, [ladder, announce]);

  // FLIP: chips that changed rung glide from their old offset; promoted numerals roll after the slide.
  useLayoutEffect(() => {
    const root = strip.current;
    if (!root) return;
    const quiet = prefersReducedMotion();
    const delay = performance.now() - leftAt.current < 200 ? 140 : 0;
    const seen: Record<string, number> = {};
    for (const chip of root.querySelectorAll<HTMLElement>(".chip[data-option]:not(.leaving)")) {
      const id = chip.dataset.option ?? "";
      seen[id] = chip.offsetTop;
      const before = offsets.current[id];
      if (quiet || before === undefined || Math.abs(before - chip.offsetTop) < 1) continue;
      chip.animate([{ transform: `translateY(${before - chip.offsetTop}px)` }, { transform: "translateY(0)" }],
        { duration: 300, delay, easing: EASE, fill: "backwards" });
    }
    offsets.current = seen;
    for (const numeral of root.querySelectorAll<HTMLElement>(".numeral-strip")) {
      if (quiet) continue;
      const steps = Number(numeral.dataset.roll ?? 0);
      if (!steps) continue;
      const roll = numeral.animate([{ transform: `translateY(-${steps * 1.2}em)` }, { transform: "translateY(0)" }],
        { duration: 560, delay: delay + 300, easing: EASE, fill: "backwards" });
      roll.onfinish = () => setRolls({});
    }
  }, [ladder, leaving]);

  useEffect(() => {
    const target = focusAfter.current?.();
    if (target && !dialog && !confirming) {
      focusAfter.current = null;
      target.focus();
    }
  });

  const days: LadderDay[] = ladder?.days ?? [];

  const move = (index: number) => {
    const next = Math.max(0, Math.min(STRIP_DAYS - 1, index));
    setFocusIndex(next);
    buttons.current[next]?.focus();
  };
  const onKey = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: index - 7,
      ArrowDown: index + 7, Home: 0, End: STRIP_DAYS - 1 };
    if (event.key in keys) {
      event.preventDefault();
      move(keys[event.key]);
    }
  };

  const dayButtonFor = (date: string) => () => buttons.current[days.findIndex((d) => d.date === date)] ?? null;

  const rail = (
    <>
      <nav aria-label="Offices">
        <p className="group-label">Offices</p>
        <ul className="office-switch">
          {OFFICE_IDS.map((id) => (
            <li key={id}>
              <Link href={`/workspace/board?office=${id}`} aria-current={id === office ? "page" : undefined}>
                {OFFICES[id].city}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <TalentList list={list} office={office} current={talent?.slug ?? ""} />
    </>
  );

  return (
    <Shell rail={rail}>
      <div className="workspace-head">
        <p className="eyebrow">{OFFICES[office].city} office</p>
        <h1>Availability board</h1>
      </div>
      <StatusLine name="Board" message={message} />
      {talent ? (
        <section className="board" aria-labelledby="board-talent">
          <h2 id="board-talent" className="board-title">{talent.displayName}</h2>
          <p className="muted board-sub">{days.length ? `From ${formatDate(days[0].date)} for 14 days, in ${OFFICES[office].city} time.`
            : "Loading the board…"}</p>
          <div ref={strip} role="grid" aria-label={`Availability for ${talent.displayName}`} className="strip">
            <div role="row" className="strip-row">
              {days.map((day, i) => (
                <div role="gridcell" key={day.date} className={day.dayState === "booked" ? "day-cell booked" : "day-cell"}>
                  <DayButton day={day} leaving={leaving[day.date] ?? []} rolls={rolls} focusable={i === focusIndex}
                    onKey={onKey(i)} onOpen={() => {
                      setFocusIndex(i);
                      setDialog({ date: day.date });
                    }} onLeft={(id) => setLeaving((all) => ({ ...all,
                      [day.date]: (all[day.date] ?? []).filter((gone) => gone.option.id !== id) }))} buttonRef={(el) => void (buttons.current[i] = el)} />
                  {day.bookingId && references[day.bookingId] ? (
                    <Link href={`/workspace/bookings/${day.bookingId}`} className="view-booking" tabIndex={-1}
                      data-booking={day.bookingId}>View booking {references[day.bookingId]}</Link>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : roster.data && !list.length ? (
        <p className="muted">No active talent in this office yet.</p>
      ) : (
        <p className="muted">Loading the board…</p>
      )}
      {dialog && talent && ladder ? (
        <DayDialog talent={talent} office={office} date={dialog.date} initial={dialog.values}
          day={days.find((d) => d.date === dialog.date) ?? days[0]} clients={clients.data?.clients ?? []}
          reloadClients={async () => (await clients.reload())?.clients ?? []}
          reference={(id) => references[id]} announce={announce}
          onConfirm={(option) => setConfirming(option)}
          onDone={async (copy) => {
            announce(copy);
            await reload();
            focusAfter.current = dayButtonFor(dialog.date);
            setDialog(null);
          }}
          onSessionEnded={(copy) => {
            announce(copy);
            setDialog(null);
          }}
          onClose={() => setDialog(null)} />
      ) : null}
      {confirming && talent ? (
        <ConfirmDialog option={confirming} talent={talent} office={office}
          onClose={() => setConfirming(null)}
          onBooked={async (copy, booking) => {
            announce(copy);
            setReferences((known) => ({ ...known, [booking.id]: booking.reference }));
            await reload();
            focusAfter.current = () => document.querySelector<HTMLElement>(`.view-booking[data-booking="${booking.id}"]`);
            setConfirming(null);
            setDialog(null);
          }}
          onSessionEnded={(copy) => {
            announce(copy);
            setConfirming(null);
            setDialog(null);
          }} />
      ) : null}
    </Shell>
  );
}

/** The office's talent: one Tab stop, Up and Down move between names. */
function TalentList({ list, office, current }: { list: TalentSummary[]; office: OfficeId; current: string }) {
  const container = useRef<HTMLUListElement>(null);
  const active = Math.max(0, list.findIndex((t) => t.slug === current));
  const onKey = (index: number) => (event: KeyboardEvent<HTMLAnchorElement>) => {
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : null;
    if (next === null) return;
    event.preventDefault();
    container.current?.querySelectorAll("a")[Math.max(0, Math.min(list.length - 1, next))]?.focus();
  };
  return (
    <div className="talent-picker">
      <p className="group-label">Talent</p>
      <ul ref={container} role="list" aria-label="Talent" className="talent-list">
        {list.map((t, i) => (
          <li key={t.id}>
            <Link href={`/workspace/board?office=${office}&talent=${t.slug}`} tabIndex={i === active ? 0 : -1}
              onKeyDown={onKey(i)} aria-current={t.slug === current ? "page" : undefined}>{t.displayName}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

definePage({ pattern: "/workspace/board", kind: "workspace", roles: ["agency_director", "booker"],
  render: () => <BoardPage /> });
