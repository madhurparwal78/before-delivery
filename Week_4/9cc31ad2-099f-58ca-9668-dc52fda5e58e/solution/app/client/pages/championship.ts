import { Trophy } from "lucide";
import { CARS, LAYOUTS } from "../../shared/model";
import { LEAGUE_TARGET } from "../../shared/rules";
import { get } from "../api";
import { h, icon } from "../dom";
import { live } from "../live";
import { navigate, type PageContext } from "../router";
import { renderShell } from "../shell";
import { outline, trackPath, tulip } from "../track";
import { openDialog } from "../ui/dialog";
import type { Championship, ChampionshipEvent } from "../types";

const LEAGUE_NAMES = { rookie: "Rookie league", club: "Club league" } as const;
const LOCKED = "Locked until the Rookie league is complete";
const TROPHY = "Club champion trophy";
const ROOKIE_DONE = "Rookie league complete. Club league and Quarry Switchbacks unlocked.";
const CLUB_DONE = "Club league complete. Trophy and 1,000 coins added.";

interface EventCard {
  readonly button: HTMLButtonElement;
  readonly points: HTMLElement;
}

export async function championshipPage(ctx: PageContext): Promise<void> {
  document.title = "Kerbline — Championship";
  let data = (await get<Championship>("/v1/championship", ctx.signal)).data;
  if (ctx.signal.aborted) return;
  const main = renderShell(true, ["Rookie", "Club", "Finals"]);
  const updates = h("p", { role: "status", "aria-label": "Championship updates", class: "status-line" });
  const cards = new Map<string, EventCard>();
  const heads = new Map<string, HTMLElement>();
  const eventById = (eventId: string) => data.leagues.flatMap((league) => league.events).find((e) => e.eventId === eventId)!;

  function raceAddress(event: ChampionshipEvent): string {
    return `/race?layout=${event.layoutId}&mode=${event.mode}&event=${event.eventId}`;
  }

  function enter(eventId: string): void {
    const event = eventById(eventId);
    if (event.eligible || !event.loanerCarId) {
      navigate(raceAddress(event));
      return;
    }
    const loaner = CARS.find((car) => car.carId === event.loanerCarId)!;
    const go = h("button", { type: "button", class: "primary" }, "Race the loaner");
    const cancel = h("button", { type: "button" }, "Cancel");
    const handle = openDialog({
      title: "Loaner car",
      body: [h("p", null, `You have no eligible class ${event.class} car. Race the loaner ${loaner.name} for half result coins?`)],
      actions: [go, cancel],
      onEscape: () => back(),
      initialFocus: go,
    });
    const back = () => {
      handle.close();
      cards.get(eventId)?.button.focus();
    };
    cancel.addEventListener("click", back);
    go.addEventListener("click", () => {
      handle.close();
      navigate(raceAddress(event));
    });
  }

  function headText(league: Championship["leagues"][number]): HTMLElement[] {
    const parts = [h("span", { class: "fig league-points" }, `${league.points} / ${LEAGUE_TARGET} points`)];
    if (league.status === "complete") parts.push(h("span", { class: "league-status" }, "Complete"));
    if (league.status === "locked") parts.push(h("span", { class: "league-status" }, LOCKED));
    if (league.leagueId === "club" && data.trophy) parts.push(h("span", { class: "trophy" }, icon(Trophy, 16), TROPHY));
    return parts;
  }

  function paint(): void {
    for (const league of data.leagues) {
      heads.get(league.leagueId)?.replaceChildren(...headText(league));
      for (const event of league.events) {
        const card = cards.get(event.eventId)!;
        card.points.textContent = `${event.points} pts`;
        card.button.disabled = league.status === "locked";
      }
    }
  }

  const leagues = data.leagues.map((league, li) => {
    const head = h("div", { class: "league-head" });
    heads.set(league.leagueId, head);
    return h("section", { class: "cell", "aria-label": LEAGUE_NAMES[league.leagueId] },
      h("div", { class: "cell-head" }, h("h2", null, `${String(li + 1).padStart(2, "0")} ${LEAGUE_NAMES[league.leagueId]}`)),
      head,
      h("div", { class: "events" }, ...league.events.map((event) => {
        const button = h("button", { type: "button", class: "dark", onclick: () => enter(event.eventId) }, `Enter ${event.name}`);
        const points = h("span", { class: "event-points" });
        cards.set(event.eventId, { button, points });
        const turns = trackPath(event.layoutId).turns;
        const corners = ["tl", "tr", "br"];
        return h("article", { class: "map-card", "aria-label": event.name },
          ...turns.map((turn, i) => {
            const glyph = tulip(turn);
            glyph.classList.add(corners[i % corners.length]);
            return glyph;
          }),
          h("div", { class: "map-card-body" },
            h("h3", null, event.name),
            h("p", { class: "label" }, `${LAYOUTS[event.layoutId].name} · class ${event.class}`),
            points),
          outline(event.layoutId, LAYOUTS[event.layoutId].name),
          h("div", { class: "map-card-action" }, button));
      })));
  });

  main.append(
    h("div", { class: "page-head" }, h("div", null, h("p", { class: "kicker" }, "Two-league ladder"), h("h1", null, "Championship"))),
    h("div", { class: "leagues" }, ...leagues), updates);
  paint();
  const focusEvent = (ctx.state as { focusEvent?: string } | null)?.focusEvent;
  if (focusEvent) cards.get(focusEvent)?.button.focus();

  const stop = live.listen((push) => {
    if (push.type !== "championship") return;
    const before = new Map(data.leagues.map((league) => [league.leagueId, league.status]));
    data = { leagues: push.leagues, trophy: push.trophy };
    paint();
    for (const league of data.leagues) {
      if (league.status === "complete" && before.get(league.leagueId) !== "complete") {
        updates.textContent = league.leagueId === "rookie" ? ROOKIE_DONE : CLUB_DONE;
      }
    }
  });
  ctx.signal.addEventListener("abort", stop);
}
