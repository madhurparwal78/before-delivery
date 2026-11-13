import { useEffect, useState } from "preact/hooks";
import type { LeagueCreated, LeagueSummary } from "../../shared/api.ts";
import { request } from "../api.ts";
import { useAnnouncer } from "../announce.ts";
import { useLive } from "../live.ts";
import { linkClick } from "../router.ts";

// Leagues: the manager's leagues, Create league and Join league (brief: Screens / Leagues).
export function LeaguesPage() {
  const [leagues, setLeagues] = useState<LeagueSummary[] | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [updates, announce] = useAnnouncer();

  const load = async () => {
    const result = await request<{ leagues: LeagueSummary[] }>("GET", "/api/leagues");
    if (result.ok) setLeagues(result.data.leagues);
  };
  useEffect(() => void load(), []);
  useLive((message) => {
    if (message.t === "league" || message.t === "gameweek" || message.t === "event") void load();
  });

  const create = async (event: Event) => {
    event.preventDefault();
    setBusy("create");
    const result = await request<LeagueCreated>("POST", "/api/leagues", { name });
    setBusy(null);
    if (result.ok) {
      setNameError(null);
      setName("");
      announce(`League created. Share code ${result.data.code ?? ""}.`);
      await load();
    } else {
      const message = result.error.fields?.name ?? result.error.message;
      setNameError(message);
      announce(message, true);
    }
  };

  const join = async (event: Event) => {
    event.preventDefault();
    setBusy("join");
    const result = await request<LeagueCreated>("POST", "/api/leagues/join", { code });
    setBusy(null);
    if (result.ok) {
      setCodeError(null);
      setCode("");
      announce(`Joined ${result.data.name}.`);
      await load();
    } else {
      const message = result.status === 404 ? "No league uses that code." : result.status === 409 ? "You are already in this league." : result.error.message;
      setCodeError(message);
      announce(message, true);
    }
  };

  return (
    <main class="wide">
      <div class="page-head">
        <h1>Leagues</h1>
      </div>
      <p class={`updates result-strip${updates.error ? " is-error" : ""}`} role="status" aria-label="League updates">
        {updates.text}
      </p>
      <div class="console">
        <form class="section panel" onSubmit={create} noValidate>
          <h2>Create league</h2>
          <div class="field">
            <label for="league-name">League name</label>
            <input
              id="league-name"
              class="input"
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
              aria-invalid={nameError ? "true" : undefined}
              aria-describedby={nameError ? "league-name-error" : undefined}
            />
            {nameError && (
              <p class="field-error" id="league-name-error">
                {nameError}
              </p>
            )}
          </div>
          <button type="submit" class="btn btn-primary" disabled={busy === "create"}>
            {busy === "create" ? "Creating…" : "Create league"}
          </button>
        </form>
        <form class="section panel" onSubmit={join} noValidate>
          <h2>Join league</h2>
          <div class="field">
            <label for="join-code">Join code</label>
            <input
              id="join-code"
              class="input mono"
              value={code}
              autocomplete="off"
              onInput={(e) => setCode(e.currentTarget.value)}
              aria-invalid={codeError ? "true" : undefined}
              aria-describedby={codeError ? "join-code-error" : undefined}
            />
            {codeError && (
              <p class="field-error" id="join-code-error">
                {codeError}
              </p>
            )}
          </div>
          <button type="submit" class="btn btn-primary" disabled={busy === "join"}>
            {busy === "join" ? "Joining…" : "Join league"}
          </button>
        </form>
      </div>
      {leagues === null ? (
        <p class="loading">Loading leagues…</p>
      ) : leagues.length === 0 ? (
        <p class="empty-note">You are not in a mini league yet. Create one for your group, or join with a six-character code.</p>
      ) : (
        <div class="table-frame" tabIndex={0} role="region" aria-label="Your leagues, scrollable">
          <table aria-label="Your leagues">
            <thead>
              <tr>
                <th scope="col">League</th>
                <th scope="col" class="num">
                  Your rank
                </th>
                <th scope="col" class="num">
                  Members
                </th>
              </tr>
            </thead>
            <tbody>
              {leagues.map((league) => (
                <tr key={league.id} class="control-row">
                  <td>
                    <a href={`/leagues/${league.id}`} onClick={(event) => linkClick(event, `/leagues/${league.id}`)}>
                      {league.name}
                    </a>
                    {league.is_admin && <span class="hint"> admin</span>}
                  </td>
                  <td class="num">{league.rank}</td>
                  <td class="num">{league.members}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
