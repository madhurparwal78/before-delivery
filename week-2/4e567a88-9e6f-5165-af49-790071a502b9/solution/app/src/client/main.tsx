// Entry: session check, the signed-in shell (top bar, Service status, Notices) and screen routing.

import { options, render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { fieldKind } from "../shared/schema";
import { get, request, type Member, type Model, type Policy, type Team } from "./api";
import { AdminScreen } from "./admin";
import { FinanceScreen } from "./finance";
import {
  SCREEN_NAMES, navigate, setOrgZone, useMedia, usePath, usePoll, type Screen,
} from "./hooks";
import { Icon } from "./icons";
import { JobsScreen } from "./jobs";
import { LibraryScreen } from "./library";
import { RunScreen, type RunState } from "./run";
import { SessionContext, isOrgRole, teamNameOf, type Session } from "./session";
import { SignIn } from "./signin";
import { WebhooksScreen } from "./webhooks";

const SCREENS_BY_ROLE: Record<Member["role"], Screen[]> = {
  member: ["run", "jobs", "library", "webhooks"],
  admin: ["jobs", "library", "webhooks", "finance", "admin"],
  finance: ["jobs", "library", "finance", "admin"],
  compliance: ["jobs", "library"],
};

const STORAGE_NOTICE = "Storage is unreachable. New jobs wait in the queue, and uploads and image links are paused.";
const BILLING_NOTICE = "Billing is unreachable. Top-ups stay pending until it returns.";

const ROLE_WORDS: Record<Member["role"], string> = {
  member: "Member", admin: "Org admin", finance: "Finance controller", compliance: "Compliance reviewer",
};

const homeOf = (me: Member): Screen => SCREENS_BY_ROLE[me.role][0];

function Shell({ me, onSignedOut }: { me: Member; onSignedOut: () => void }) {
  const path = usePath();
  const allowed = SCREENS_BY_ROLE[me.role];
  const requested = path.replace(/^\//, "").split("/")[0] as Screen;
  const screen: Screen = allowed.includes(requested) ? requested : homeOf(me);
  const wide = useMedia("(min-width: 1024px)");

  const [models, setModels] = useState<Model[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [chosenTeam, setChosenTeam] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [outages, setOutages] = useState<{ storage: boolean; billing: boolean }>({ storage: false, billing: false });
  const [menuOpen, setMenuOpen] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [run, setRun] = useState<RunState>({ model: "", focus: false, prefill: null, version: 0 });

  useEffect(() => {
    if (path !== `/${screen}`) navigate(`/${screen}`);
  }, [path, screen]);

  useEffect(() => {
    setNotice("");
    setMenuOpen(false);
  }, [screen]);

  useEffect(() => {
    void get<{ teams: Team[] }>("/api/teams").then((r) => setTeams(r.teams));
    if (me.role === "admin" || me.role === "finance") {
      void get<{ policy: Policy }>("/api/policy").then((r) => setOrgZone(r.policy.timezone), () => undefined);
    }
  }, []);

  usePoll(async () => {
    const { models: catalogue } = await get<{ models: Model[] }>("/api/models");
    setModels(catalogue);
    setRun((r) => (r.model ? r : {
      ...r, model: (catalogue.find((m) => m.access?.playground !== "blocked") ?? catalogue[0])?.slug ?? "",
    }));
  }, 3000, []);

  usePoll(async () => {
    const status = await get<{ storage: string; billing: string }>("/api/system");
    setOutages({ storage: status.storage === "down", billing: status.billing === "down" });
  }, 1000, []);

  const teamId = me.team_id ?? chosenTeam ?? teams[0]?.id ?? "";
  const session = useMemo<Session>(() => ({
    me, models, teams, teamId, setTeamId: setChosenTeam, notify: setNotice,
  }), [me, models, teams, teamId]);

  const choose = (slug: string) => setRun((r) => ({ model: slug, focus: true, prefill: null, version: r.version + 1 }));
  const useAsInput = (assetId: string) => {
    const current = models.find((m) => m.slug === run.model);
    const hasMedia = current && Object.values(current.input_schema.properties).some((p) => fieldKind(p) === "media");
    setRun((r) => ({
      model: hasMedia ? r.model : "reel-10", focus: false, prefill: `asset:${assetId}`, version: r.version + 1,
    }));
    navigate("/run");
  };

  const signOut = async () => {
    await request("DELETE", "/api/session").catch(() => undefined);
    onSignedOut();
  };

  const ready = models.length > 0 && teams.length > 0 && teamId !== "";
  const team = teamId ? teamNameOf(session, teamId) : "";

  return (
    <SessionContext.Provider value={session}>
      <a class="skip-link" href="#main">Skip to main content</a>
      <header class="topbar">
        <span class="brand">Lumenfold Dispatch</span>
        {screen === "run" && !wide && (
          <button type="button" class="btn btn--quiet topbar__catalogue" aria-haspopup="dialog"
            onClick={() => setCatalogueOpen(true)}>
            <Icon name="catalogue" size={18} /><span class="topbar__catalogue-word">Catalogue</span>
          </button>
        )}
        <nav id="primary-nav" class={`primary${menuOpen ? " is-open" : ""}`} aria-label="Primary">
          <ul class="primary__list">
            {allowed.map((s) => (
              <li key={s}>
                <a href={`/${s}`} class="primary__link" aria-current={s === screen ? "page" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    setMenuOpen(false);
                    navigate(`/${s}`);
                  }}>
                  <Icon name={s} size={18} />{SCREEN_NAMES[s]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div class="topbar__who">
          <span class="topbar__name">{me.name}</span>
          <span class="topbar__team">{isOrgRole(me) ? ROLE_WORDS[me.role] : team}</span>
        </div>
        <button type="button" class="btn btn--secondary topbar__signout" onClick={signOut}>Sign out</button>
        <button type="button" class="btn btn--quiet topbar__menu" aria-expanded={menuOpen ? "true" : "false"}
          aria-controls="primary-nav" onClick={() => setMenuOpen((open) => !open)}>
          <Icon name="menu" size={18} /><span>Menu</span>
        </button>
      </header>
      <section class="service-status" role="region" aria-label="Service status">
        {outages.storage && <p class="service-status__notice">{STORAGE_NOTICE}</p>}
        {outages.billing && <p class="service-status__notice">{BILLING_NOTICE}</p>}
      </section>
      <div class="notices" role="status" aria-label="Notices" aria-live="polite">{notice}</div>
      <main id="main" class="main" tabIndex={-1}>
        {!ready ? <p class="muted loading">Loading…</p>
          : screen === "run" ? <RunScreen run={run} choose={choose} catalogueOpen={catalogueOpen}
            closeCatalogue={() => setCatalogueOpen(false)} wide={wide} />
            : screen === "jobs" ? <JobsScreen />
              : screen === "library" ? <LibraryScreen onUseAsInput={useAsInput} />
                : screen === "webhooks" ? <WebhooksScreen />
                  : screen === "finance" ? <FinanceScreen />
                    : <AdminScreen />}
      </main>
    </SessionContext.Provider>
  );
}

function App() {
  const [me, setMe] = useState<Member | null | undefined>(undefined);
  useEffect(() => {
    get<{ member: Member }>("/api/me").then((r) => setMe(r.member), () => setMe(null));
  }, []);
  if (me === undefined) return null;
  if (me === null) {
    return <SignIn onSignedIn={(member) => {
      navigate(`/${homeOf(member)}`);
      setMe(member);
    }} />;
  }
  return <Shell key={me.id} me={me} onSignedOut={() => setMe(null)} />;
}

// Effects (data loads, focus moves) run right after each render on a message-channel task rather than on
// the next animation frame, so a throttled or backgrounded tab never holds a request back.
const effects = new MessageChannel();
let pendingEffects: Array<() => void> = [];
effects.port1.onmessage = () => {
  const run = pendingEffects;
  pendingEffects = [];
  run.forEach((effect) => effect());
};
options.requestAnimationFrame = (effect) => {
  pendingEffects.push(effect);
  if (pendingEffects.length === 1) effects.port2.postMessage(null);
};

// The first layout uses the brand faces: swapping them in after it re-wraps the narrow top bar and moves the page.
const FACES = [
  "600 1em 'Bricolage Grotesque'", "700 1em 'Bricolage Grotesque'",
  "400 1em 'IBM Plex Sans'", "500 1em 'IBM Plex Sans'", "600 1em 'IBM Plex Sans'",
  "400 1em 'IBM Plex Mono'", "500 1em 'IBM Plex Mono'",
];
const FONT_WAIT_MS = 3000;
void Promise.race([
  Promise.all(FACES.map((face) => document.fonts.load(face))).catch(() => undefined),
  new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
]).then(() => render(<App />, document.getElementById("app")!));
