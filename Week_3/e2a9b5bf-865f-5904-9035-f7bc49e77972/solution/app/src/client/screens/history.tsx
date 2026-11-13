import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { apertureLabel } from "../../shared/optics";
import { useSelect } from "../lib/store";
import { observationDelete, queueChanges } from "../state/changes";
import { newestObservations, objectOf, useEffective } from "../state/lookup";
import { app, isOffline } from "../state/model";
import { refreshHistory, refreshObjects } from "../state/refresh";
import { requestSync } from "../state/sync";
import { DeleteDialog, type DeleteTarget } from "../ui/delete-dialog";
import { useDialog } from "../ui/dialog";
import { connection, NotFoundScreen, Skeleton, WorkingScreen } from "../ui/layout";

export function HistoryScreen({ objectId }: { objectId: string }) {
  const objects = useSelect(app, (s) => s.server.objects);
  const offline = useSelect(app, (s) => isOffline(s));
  const loaded = useSelect(app, (s) => s.deviceLoaded);
  const eff = useEffective();
  const object = objectOf(objects, objectId);
  const [status, setStatus] = useState<number | null>(null);
  const [fetched, setFetched] = useState(false);
  const dialog = useDialog();
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const list = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    setFetched(false);
    setStatus(null);
    if (!app.get().server.objects) void refreshObjects();
    void refreshHistory(objectId).then((s) => {
      setStatus(s);
      setFetched(true);
    });
  }, [objectId]);

  const rows = newestObservations(eff, objectId);

  useLayoutEffect(() => {
    connection.set({ notHere: offline && !object && loaded });
  }, [offline, object, loaded]);

  if (status === 404 || (objects && !object)) return <NotFoundScreen />;
  if (!object) {
    return (
      <WorkingScreen heading="Object history">
        <Skeleton rows={3} />
      </WorkingScreen>
    );
  }

  const ask = (obs: (typeof rows)[number]) => {
    setTarget({ id: obs.id, designation: obs.designation, date: obs.evening_date });
    dialog.show();
  };

  const confirm = (picked: DeleteTarget) => {
    const index = rows.findIndex((r) => r.id === picked.id);
    const neighbour = rows[index + 1] ?? rows[index - 1];
    const obs = rows[index];
    dialog.close(false);
    const items = list.current?.querySelectorAll<HTMLLIElement>("li") ?? [];
    const keep = neighbour ? [...items][rows.indexOf(neighbour)]?.querySelector<HTMLElement>("a") : null;
    (keep ?? document.querySelector<HTMLElement>('nav[aria-label="Main"] a'))?.focus();
    if (!obs) return;
    void queueChanges(
      [
        {
          change: observationDelete(obs.id, obs.version),
          meta: { designation: obs.designation, date: obs.evening_date, observationId: obs.id, sessionId: obs.session_id },
        },
      ],
      "save",
    ).then(() => requestSync());
  };

  return (
    <WorkingScreen heading={`${object.designation} ${object.name}`}>
      {rows.length > 0 ? (
        <ul class="rows history" aria-label={`Observations of ${object.designation}`} ref={list}>
          {rows.map((obs) => (
            <li key={obs.id} class="history-row">
              <div class="history-head">
                <span class="ink designation">{obs.designation}</span>
                <span class="muted">
                  {`${obs.evening_date}${obs.local_time ? ` · ${obs.local_time} local, UTC${obs.local_offset}` : ""} · ${apertureLabel(obs.derived.aperture_mm)} mm · ${obs.derived.magnification}×`}
                </span>
              </div>
              {obs.description ? <p class="ink description-line">{obs.description}</p> : null}
              <div class="row-actions">
                <a class="btn" href={`/sessions/${obs.session_id}?observation=${obs.id}`}>
                  Open
                </a>
                <button type="button" class="btn" onClick={() => ask(obs)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : fetched || loaded ? (
        <p class="muted">No observations of {object.designation} yet.</p>
      ) : (
        <Skeleton rows={3} />
      )}
      <DeleteDialog handle={dialog} target={target} onConfirm={confirm} />
    </WorkingScreen>
  );
}
