import { useLayoutEffect, useState } from "preact/hooks";
import { COPY } from "../../shared/messages";
import { eveningDate, parseUtc } from "../../shared/time";
import type { Optics } from "../../shared/types";
import { uuid } from "../lib/ids";
import { navigate } from "../lib/router";
import { useSelect } from "../lib/store";
import { sessionCreate } from "../state/changes";
import { queueChanges } from "../state/changes";
import { app } from "../state/model";
import { useEffective } from "../state/lookup";
import { refreshKit, refreshSessionList } from "../state/refresh";
import { requestSync } from "../state/sync";
import { FieldShell, useSingleFlight } from "../ui/form";
import { RingIcon } from "../ui/icons";
import { Skeleton, WorkingScreen } from "../ui/layout";

export function TonightScreen() {
  const kit = useSelect(app, (s) => s.server.kit);
  const sites = useSelect(app, (s) => s.server.sites);
  const loaded = useSelect(app, (s) => s.deviceLoaded);
  const eff = useEffective();
  const [siteId, setSiteId] = useState("");
  const [message, setMessage] = useState("");
  const flight = useSingleFlight();

  useLayoutEffect(() => {
    void refreshKit();
    void refreshSessionList();
  }, []);

  const chosen = sites?.find((s) => s.id === siteId) ?? sites?.[0];

  const start = () =>
    void flight(async () => {
      let currentKit = kit;
      let currentSites = sites;
      if (!currentKit || !currentSites) {
        await refreshKit();
        currentKit = app.get().server.kit;
        currentSites = app.get().server.sites;
      }
      const site = currentSites?.find((s) => s.id === siteId) ?? currentSites?.[0];
      const telescope = currentKit?.telescopes[0];
      const eyepiece = currentKit?.eyepieces[0];
      if (!telescope || !eyepiece) return setMessage(COPY.tonightKit);
      if (!site) return setMessage(COPY.tonightSite);
      setMessage("");
      const optics: Optics = { telescope_id: telescope.id, eyepiece_id: eyepiece.id, barlow_id: null, train: "straight" };
      const id = uuid();
      const started = parseUtc(new Date().toISOString());
      const date = started ? eveningDate(started, site.time_zone) : "";
      await queueChanges(
        [{ change: sessionCreate(id, site.id, optics), meta: { designation: null, date, observationId: null, sessionId: id } }],
        "save",
      );
      navigate(`/sessions/${id}`);
      void requestSync();
    });

  const sessions = Object.values(eff.sessions).sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0));

  return (
    <WorkingScreen heading="Tonight">
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <FieldShell label="Site" id="tonight-site">
          <select id="tonight-site" value={chosen?.id ?? ""} onChange={(e) => setSiteId((e.target as HTMLSelectElement).value)}>
            {(sites ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FieldShell>
        <div role="status" aria-label="Tonight status" class="sentences">
          {message ? <p class="sentence">{message}</p> : null}
        </div>
        <button type="submit" class="btn primary">
          Start session
        </button>
      </form>
      <h2>Sessions</h2>
      {sessions.length > 0 ? (
        <ul class="rows" aria-label="Sessions">
          {sessions.map((s) => (
            <li key={s.id}>
              <a class="row-link ink" href={`/sessions/${s.id}`}>
                {s.evening_date} · {s.site.name}
              </a>
              <span class="muted">{` ${s.observation_count} ${s.observation_count === 1 ? "observation" : "observations"}`}</span>
            </li>
          ))}
        </ul>
      ) : loaded ? (
        <div class="empty">
          <RingIcon />
          <p class="muted">No sessions yet. Start one above when the sky is dark.</p>
        </div>
      ) : (
        <Skeleton rows={3} />
      )}
    </WorkingScreen>
  );
}
