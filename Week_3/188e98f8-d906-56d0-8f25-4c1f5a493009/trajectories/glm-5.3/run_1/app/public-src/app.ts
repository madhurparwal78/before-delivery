import { getSession } from "./api";
import { COPY } from "./copy";
import { DeskMessages, TableNews, el, notFoundScreen, renderRoundStrip, renderTileGrid, renderTileContainer } from "./shell";
import { renderSignIn } from "./signin";
import { CaptainDesk } from "./captain";
import { MarkerDesk } from "./marker";
import { QuizmasterDesk } from "./quizmaster";
import { ArchiveScreen } from "./archive";
import type { LeagueTable, Round } from "./util";

interface Poller {
  stop(): void;
}

let activePoller: Poller | undefined;

function startTable(main: HTMLElement, messages: DeskMessages, tableNews: TableNews): void {
  main.textContent = "";
  renderTileContainer(main);
  const read = async (): Promise<void> => {
    const { getRounds, getTable } = await import("./api");
    const [roundsResult, tableResult, sessionResult] = await Promise.all([getRounds(), getTable(), getSession()]);
    if (roundsResult.status !== 200 || tableResult.status !== 200) {
      messages.show(COPY.unreachable);
      return;
    }
    const rounds = (roundsResult.body as { rounds: Round[] }).rounds;
    const table = tableResult.body as LeagueTable;
    renderRoundStrip(document.body, rounds);
    const previousVersion = Number(main.dataset["tableVersion"] ?? "0");
    if (previousVersion !== table.version && main.dataset["tableVersion"] !== undefined) {
      const leader = table.teams[0];
      tableNews.announce(COPY.publishedNews(table.last_published_round ?? 0, leader.name, leader.total));
    }
    main.dataset["tableVersion"] = String(table.version);
    renderTileGrid(main, table, tableNews, undefined);
    if (sessionResult.status === 200) {
      const body = sessionResult.body as { role: string };
      void body;
    }
  };
  void read();
  window.setInterval(() => void read(), 3000);
}

function startDesk(): void {
  const main = document.getElementById("app-root");
  const modal = document.getElementById("modal-root");
  if (main === null || modal === null) return;
  const messages = new DeskMessages(main);
  const tableNews = new TableNews(main);
  const path = window.location.pathname;
  void (async () => {
    const session = await getSession();
    if (session.status === 401) {
      if (path === "/captain" || path === "/marker" || path === "/quizmaster" || path === "/archive") {
        window.location.assign("/sign-in");
        return;
      }
    }
    const role = session.status === 200 ? (session.body as { role: "quizmaster" | "marker" | "captain" }).role : "none";
    switch (path) {
      case "/":
        startTable(main, messages, tableNews);
        break;
      case "/sign-in": {
        renderSignIn(main, messages);
        break;
      }
      case "/captain": {
        if (role !== "captain") {
          window.location.assign("/sign-in");
          return;
        }
        const body = session.body as { team_id: number; team_name: string | null };
        const desk = new CaptainDesk(main, messages, tableNews, { teamId: body.team_id, teamName: body.team_name ?? "" });
        desk.start();
        break;
      }
      case "/marker": {
        if (role !== "marker") {
          window.location.assign("/sign-in");
          return;
        }
        new MarkerDesk(main, messages).start();
        break;
      }
      case "/quizmaster": {
        if (role !== "quizmaster") {
          window.location.assign("/sign-in");
          return;
        }
        new QuizmasterDesk(main, messages, tableNews).start();
        break;
      }
      case "/archive": {
        if (role !== "marker" && role !== "quizmaster") {
          window.location.assign("/sign-in");
          return;
        }
        new ArchiveScreen(main, messages).start();
        break;
      }
      default:
        notFoundScreen(main);
        break;
    }
    const { getRounds } = await import("./api");
    const roundsResult = await getRounds();
    if (roundsResult.status === 200) {
      renderRoundStrip(document.body, (roundsResult.body as { rounds: Round[] }).rounds);
    }
  })();
}

window.addEventListener("DOMContentLoaded", () => {
  startDesk();
  void activePoller;
});
