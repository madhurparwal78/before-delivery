import { useLayoutEffect, useState } from "preact/hooks";
import { COPY } from "../../shared/messages";
import { apertureLabel } from "../../shared/optics";
import type { Observation } from "../../shared/types";
import { navigate } from "../lib/router";
import { useSelect } from "../lib/store";
import { call } from "../state/http";
import { localProgress } from "../state/effective";
import { useEffective } from "../state/lookup";
import { app, isOffline } from "../state/model";
import { refreshProgram } from "../state/refresh";
import { useSingleFlight } from "../ui/form";
import { connection, NotFoundScreen, Skeleton, WorkingScreen } from "../ui/layout";

export function ProgramScreen({ id }: { id: string }) {
  const detail = useSelect(app, (s) => s.server.programDetails[id]);
  const offline = useSelect(app, (s) => isOffline(s));
  const waiting = useSelect(app, (s) => s.journal.length);
  const eff = useEffective();
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState("");
  const flight = useSingleFlight();

  useLayoutEffect(() => {
    setMissing(false);
    void refreshProgram(id).then((status) => {
      if (status === 404) setMissing(true);
    });
  }, [id]);

  useLayoutEffect(() => {
    connection.set({ notHere: !detail && offline });
  }, [detail, offline]);

  if (missing) return <NotFoundScreen />;
  if (!detail) {
    return (
      <WorkingScreen heading="Program">
        <Skeleton rows={4} />
      </WorkingScreen>
    );
  }

  const local = offline || waiting > 0;
  const computed = localProgress(detail, eff);
  const qualifying = local ? computed.qualifying : detail.progress.qualifying;
  const total = detail.progress.total;
  const newest = detail.editions[detail.editions.length - 1];

  const rows = detail.objects.map((object) => {
    let observation: Observation | null = null;
    if (local) {
      observation = computed.rows.find((r) => r.object_id === object.object_id)?.observation ?? null;
    } else if (object.qualifying_observation_id) {
      observation = eff.observations[object.qualifying_observation_id] ?? null;
    }
    return { object, observation };
  });

  const build = () =>
    void flight(async () => {
      setMessage("");
      const fresh = await call<{ objects: { object_id: string; qualifying_observation_id: string | null }[] }>("GET", `/api/programs/${id}`);
      if (!fresh) return setMessage(COPY.needsSignal);
      const ids: string[] = [];
      for (const object of fresh.body.objects ?? []) {
        if (object.qualifying_observation_id) {
          ids.push(object.qualifying_observation_id);
          continue;
        }
        const history = await call<{ observations: { id: string }[] }>("GET", `/api/objects/${object.object_id}/history`);
        if (!history) return setMessage(COPY.needsSignal);
        const first = history.body.observations?.[0];
        if (first) ids.push(first.id);
      }
      const made = await call<{ id?: string }>("POST", "/api/packets", { program_id: id, observation_ids: ids });
      if (!made) return setMessage(COPY.needsSignal);
      if (made.status === 201 && made.body.id) return navigate(`/packets/${made.body.id}`);
      setMessage(made.status === 422 ? "Log an observation of one of these objects first." : COPY.serverError);
    });

  return (
    <WorkingScreen heading={detail.name}>
      <div
        role="progressbar"
        aria-label={`Progress toward ${detail.name}`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={qualifying}
        class="progress"
      >
        <div class="progress-fill" style={{ width: `${total ? (qualifying / total) * 100 : 0}%` }} />
      </div>
      <p class="sentence counts">{COPY.counts(qualifying, total, detail.required_count)}</p>
      {detail.editions.length > 1 && newest ? (
        <div role="status" aria-label="Program rules" class="sentences">
          <p class="sentence">{COPY.edition(newest.edition, newest.effective_from)}</p>
        </div>
      ) : null}
      <h2>Checklist</h2>
      <ul class="rows" aria-label="Checklist">
        {rows.map(({ object, observation }) => (
          <li key={object.object_id} class="checklist-row">
            <span class="ink">{`${object.designation}, ${object.name}`}</span>
            <span class="muted">
              {observation
                ? `${observation.evening_date} · ${apertureLabel(observation.derived.aperture_mm)} mm · ${observation.derived.magnification}×`
                : "not yet"}
            </span>
          </li>
        ))}
      </ul>
      <div role="status" aria-label="Program status" class="sentences">
        {message ? <p class="sentence">{message}</p> : null}
      </div>
      <div class="actions">
        <button type="button" class="btn" onClick={build}>
          Build packet
        </button>
      </div>
    </WorkingScreen>
  );
}
