// The programme page: hero lattice, schedule with the agenda, pinned story, gallery and tickets.
import { useEffect, useMemo } from "react";
import { buyPass, holdSeat, joinWaitlist, takeResume, ticketsForAgenda } from "../checkout/actions.ts";
import { Gallery } from "../components/Gallery.tsx";
import { Schedule } from "../components/Schedule.tsx";
import { Story } from "../components/Story.tsx";
import { Tickets } from "../components/Tickets.tsx";
import { LatticeFigure } from "../lattice/LatticeFigure.tsx";
import { useDisplayFit } from "../motion/fitDisplay.ts";
import { useScrollMotion } from "../motion/useScrollMotion.ts";
import { useLocation } from "../router.ts";
import { useSession } from "../session.tsx";
import { agendaView, useAgenda } from "../state/agenda.ts";
import { dropUnknownFilters, setFilters, useFilters, type Filters } from "../state/filters.ts";
import { useProgramme } from "../state/programme.ts";
import type { Programme as ProgrammeData } from "../types.ts";

function LatticeControls({ programme, filters }: { programme: ProgrammeData | null; filters: Filters }) {
  const toggle = (kind: "day" | "venue" | "discipline", id: string) => setFilters({ [kind]: filters[kind] === id ? null : id });
  const group = (kind: "day" | "venue" | "discipline", label: string, items: { id: string; name: string }[]) => (
    <div className="controls__set">
      <span className="controls__legend" aria-hidden="true">{label}</span>
      {items.map((item) => (
        <button key={item.id} type="button" className={`toggle toggle--${kind}`} data-discipline={kind === "discipline" ? item.id : undefined}
          aria-pressed={filters[kind] === item.id} aria-label={`${label}: ${item.name}`} onClick={() => toggle(kind, item.id)}>
          {item.name}
        </button>
      ))}
    </div>
  );
  return (
    <div role="group" aria-label="Lattice controls" className="controls">
      {group("day", "Day", programme?.festival_days.map((d) => ({ id: d.date, name: d.label })) ?? [])}
      {group("venue", "Venue", programme?.venues ?? [])}
      {group("discipline", "Discipline", programme?.disciplines ?? [])}
    </div>
  );
}

export function Programme() {
  const programme = useProgramme(true);
  const { user } = useSession();
  const { search } = useLocation();
  const filters = useFilters(programme);
  const agendaIds = useAgenda();
  const agenda = useMemo(() => agendaView(programme?.sessions ?? [], agendaIds), [programme, agendaIds]);
  useScrollMotion(!!programme);
  useDisplayFit(!!programme);

  useEffect(() => {
    if (programme) dropUnknownFilters(search, programme);
  }, [programme, search]);

  useEffect(() => {
    if (!user || !programme) return;
    const resume = takeResume();
    if (!resume) return;
    const [kind, a, b] = resume.split(":");
    const session = programme.sessions.find((s) => s.id === a);
    if (kind === "agenda") void ticketsForAgenda(user, agenda.chosen);
    else if (kind === "hold" && session) void holdSeat(user, session);
    else if (kind === "waitlist" && session) void joinWaitlist(user, session);
    else if (kind === "buy") buyPass(user, a === "full" ? "full" : "day", b || null);
  }, [user, programme, agenda.chosen]);

  const pick = (key: string) => {
    const [kind, id] = key.split(":") as ["day" | "venue" | "discipline", string];
    setFilters({ [kind]: filters[kind] === id ? null : id });
  };

  return (
    <>
      <section className="section section--hero" data-ground="hero" aria-label="Kerf Frequencies 2027">
        <div className="grid hero__inner">
          <p className="hero__kicker">Kerf Collective · Brussels · 28–31 October</p>
          <h1 className="display hero__title" data-fit>
            <span className="hero__line" data-fit-line>Kerf Frequencies</span><span className="hero__line hero__year" data-fit-line> 2027</span>
          </h1>
          <p className="hero__lede">Four days of sound, light, code and performance across five venues. Pick a day, a venue or a discipline in the lattice to narrow the programme.</p>
        </div>
        <LatticeFigure programme={programme} filters={filters} lit={agendaIds} seams={agenda.pairs} onPick={pick} />
        <div className="grid">
          <LatticeControls programme={programme} filters={filters} />
        </div>
      </section>
      <Schedule programme={programme} filters={filters} agenda={agenda} agendaIds={agendaIds} user={user} />
      <Story />
      <Gallery />
      <Tickets programme={programme} user={user} filters={filters} />
    </>
  );
}
