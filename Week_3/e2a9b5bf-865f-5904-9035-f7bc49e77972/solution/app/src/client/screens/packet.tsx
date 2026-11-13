import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { COPY } from "../../shared/messages";
import { coverPage, rowPage, type PageObservation } from "../../shared/packet-page";
import { parseStrokeFile } from "../../shared/stroke";
import type { Observation, Packet, StrokeFile } from "../../shared/types";
import { useSelect } from "../lib/store";
import { objectOf, useEffective } from "../state/lookup";
import { app } from "../state/model";
import { act, loadPacket, packets, setNote, setRowsNote, statusText, type Outcome } from "../state/packets";
import { refreshKit, refreshObjects, refreshObservation, refreshPrograms } from "../state/refresh";
import { Dialog, useDialog } from "../ui/dialog";
import { NotFoundScreen, Skeleton, WorkingScreen } from "../ui/layout";

const EDITABLE = new Set(["draft", "checked"]);

export function PacketScreen({ id }: { id: string }) {
  const view = useSelect(packets, (s) => s.byId[id]);
  const programs = useSelect(app, (s) => s.server.programs);
  const eff = useEffective();
  const [missing, setMissing] = useState(false);
  const [ready, setReady] = useState(false);
  const busy = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const problems = useRef<HTMLUListElement>(null);
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const pendingFocus = useRef<(() => HTMLElement | null) | null>(null);
  const send = useDialog();
  const [, bump] = useState(0);

  // The screen paints once its packet, program and cited observations are all held, so its
  // controls never move under the pointer as the pieces arrive.
  useLayoutEffect(() => {
    setMissing(false);
    setReady(false);
    let live = true;
    const server = app.get().server;
    void Promise.all([
      loadPacket(id).then(async (status) => {
        if (status === 404 && live) setMissing(true);
        const cited = packets.get().byId[id]?.packet.observation_ids ?? [];
        const held = app.get().server.observations;
        await Promise.all(cited.filter((oid) => !held[oid]).map((oid) => refreshObservation(oid)));
      }),
      server.programs ? null : refreshPrograms(),
      server.kit ? null : refreshKit(),
      server.objects ? null : refreshObjects(),
    ]).finally(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [id]);

  const packet = view?.packet;
  const program = programs?.find((p) => p.id === packet?.program_id);
  const coordinator = program?.coordinator_name ?? "the coordinator";

  // One timer, one request in flight, only while the packet is rendering or sending.
  const polling = packet && (packet.state === "rendering" || packet.state === "sending" || view?.sending);
  useLayoutEffect(() => {
    if (!polling) return;
    let flying = false;
    const timer = window.setInterval(() => {
      if (flying) return;
      flying = true;
      void loadPacket(id).finally(() => {
        flying = false;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [id, Boolean(polling)]);

  // Observations the packet cites that this device does not hold yet.
  useLayoutEffect(() => {
    for (const oid of packet?.observation_ids ?? []) if (!eff.observations[oid]) void refreshObservation(oid);
  }, [packet?.observation_ids.join(",")]);

  useLayoutEffect(() => {
    const focus = pendingFocus.current;
    if (!focus) return;
    const el = focus();
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  });

  if (missing) return <NotFoundScreen />;
  if (!view || !packet || !ready) {
    return (
      <WorkingScreen heading="Packet">
        <Skeleton rows={4} />
      </WorkingScreen>
    );
  }

  const { label, sentence } = statusText(view, coordinator);
  const rows = packet.observation_ids.map((oid) => eff.observations[oid]).filter((o): o is Observation => Boolean(o));
  const ids = packet.observation_ids;
  const editable = EDITABLE.has(packet.state) && !view.sending;

  const focusPanel = () => panel.current?.focus();
  const run = async (action: () => Promise<Outcome>, after: (outcome: Outcome) => void) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const outcome = await action();
      after(outcome);
    } finally {
      busy.current = false;
    }
  };

  const remove = (obs: Observation) => {
    const at = ids.indexOf(obs.id);
    const next = ids[at + 1] ?? ids[at - 1];
    void run(
      () => act(packet, "rows", { observation_ids: ids.filter((x) => x !== obs.id) }),
      (outcome) => {
        if (outcome === "stale") return focusPanel();
        if (outcome !== "ok") return;
        pendingFocus.current = () => (next ? refs.current[`remove:${next}`] : null) ?? refs.current["check"] ?? null;
        bump((n) => n + 1);
      },
    );
  };

  const move = (obs: Observation, delta: number) => {
    const at = ids.indexOf(obs.id);
    const to = at + delta;
    if (to < 0 || to >= ids.length) return;
    const order = [...ids];
    [order[at], order[to]] = [order[to]!, order[at]!];
    void run(
      () => act(packet, "rows", { observation_ids: order }),
      (outcome) => {
        if (outcome === "stale") return focusPanel();
        if (outcome !== "ok") return;
        setRowsNote(id, COPY.rowMoved(obs.designation, to + 1, ids.length));
        pendingFocus.current = () =>
          refs.current[`${delta < 0 ? "up" : "down"}:${obs.id}`] ?? refs.current[`${delta < 0 ? "down" : "up"}:${obs.id}`] ?? null;
        bump((n) => n + 1);
      },
    );
  };

  const check = () =>
    void run(
      () => act(packet, "check"),
      (outcome) => {
        if (outcome === "incomplete") {
          pendingFocus.current = () => problems.current;
          bump((n) => n + 1);
        } else if (outcome === "ok" || outcome === "stale") focusPanel();
      },
    );

  const render = () =>
    void run(
      () => act(packet, "render"),
      (outcome) => {
        if (outcome === "ok" || outcome === "stale") focusPanel();
      },
    );

  const sendNow = () => {
    if (busy.current) return;
    send.close(false);
    focusPanel();
    void run(
      () => act(packet, "send"),
      (outcome) => {
        if (outcome === "stale") focusPanel();
      },
    );
  };

  const reasons = view.note?.reasons ?? [];
  const showProblems = packet.state === "draft" && reasons.length > 0 && view.note && view.note.atRevision >= packet.revision;
  const button = (name: string, onClick: () => void, primary = false, key = name) => (
    <button
      type="button"
      class={`btn${primary ? " primary" : ""}`}
      aria-busy={busy.current ? "true" : undefined}
      ref={(el) => {
        refs.current[key] = el;
      }}
      onClick={onClick}
    >
      {name}
    </button>
  );

  const download = async (event: MouseEvent) => {
    event.preventDefault();
    const answer = await fetch(`/api/packets/${id}/pdf`, { credentials: "same-origin" }).catch(() => null);
    if (!answer) return setNote(id, { text: COPY.needsSignal, atRevision: packet.revision });
    if (answer.status === 200) {
      const blob = await answer.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `lowlamp-packet-${packet.number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return;
    }
    if (answer.status === 503) setNote(id, { text: COPY.downloadStorageDown(packet.number), atRevision: packet.revision });
    else setNote(id, { text: COPY.serverError, atRevision: packet.revision });
  };

  const hasPdf = Boolean(packet.pdf) && ["rendered", "sending", "sent", "send_failed"].includes(packet.state);

  return (
    <WorkingScreen heading={`Packet ${packet.number} · ${program?.name ?? ""}`}>
      <div
        ref={panel}
        role="status"
        aria-label="Packet status"
        tabIndex={-1}
        class="packet-status"
      >
        <p class="state-label">{label}</p>
        <p class="sentence">{sentence}</p>
      </div>

      <ul class="rows packet-rows" aria-label="Packet rows">
        {ids.map((oid, index) => {
          const obs = eff.observations[oid];
          if (!obs) return <li key={oid} class="skeleton-row" aria-hidden="true" />;
          return (
          <li key={obs.id} class="packet-row">
            <div class="packet-row-text">
              <span class="ink">{obs.designation}</span>
              <span class="muted">{` ${obs.evening_date}`}</span>
            </div>
            {editable ? (
              <div class="row-actions">
                {ids.length > 1 && index > 0 ? (
                  <button
                    type="button"
                    class="btn"
                    aria-label={`Move ${obs.designation} up`}
                    ref={(el) => {
                      refs.current[`up:${obs.id}`] = el;
                    }}
                    onClick={() => move(obs, -1)}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  </button>
                ) : null}
                {ids.length > 1 && index < ids.length - 1 ? (
                  <button
                    type="button"
                    class="btn"
                    aria-label={`Move ${obs.designation} down`}
                    ref={(el) => {
                      refs.current[`down:${obs.id}`] = el;
                    }}
                    onClick={() => move(obs, 1)}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 5v14M5 12l7 7 7-7" />
                    </svg>
                  </button>
                ) : null}
                {ids.length > 1 ? (
                  <button
                    type="button"
                    class="btn"
                    aria-label={`Remove ${obs.designation}`}
                    ref={(el) => {
                      refs.current[`remove:${obs.id}`] = el;
                    }}
                    onClick={() => remove(obs)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
          );
        })}
      </ul>
      <div role="status" aria-label="Packet rows status" class="sentences">
        {view.rowsNote ? <p class="sentence">{view.rowsNote}</p> : null}
      </div>

      {showProblems ? (
        <>
        <h2>Problems</h2>
        <ul class="problems" aria-label="Packet problems" tabIndex={-1} ref={problems}>
          {reasons.map((reason, i) => (
            <li key={i} class="sentence">
              {reason.message}
            </li>
          ))}
        </ul>
        </>
      ) : null}

      <div class="actions packet-actions">
        {packet.state === "draft" ? button("Check packet", check, true, "check") : null}
        {packet.state === "checked" ? button("Render packet", render, true) : null}
        {packet.state === "render_failed" ? button("Try again", render, true) : null}
        {(packet.state === "rendered" || packet.state === "send_failed") && !view.sending
          ? button("Send to coordinator", () => send.show(), true)
          : null}
        {hasPdf ? (
          <a class="btn" href={`/api/packets/${id}/pdf`} download={`lowlamp-packet-${packet.number}.pdf`} onClick={(e) => void download(e)}>
            Download PDF
          </a>
        ) : null}
      </div>

      {hasPdf ? <PaperPreview packet={packet} rows={rows} /> : null}

      <Dialog handle={send} label="Send packet">
        <h2>Send packet</h2>
        <p class="sentence">{`Packet ${packet.number} will be emailed to ${coordinator} at ${program?.coordinator_email ?? ""}, with a copy to you.`}</p>
        <div class="dialog-actions">
          <button type="button" class="btn" data-initial onClick={sendNow}>
            Send now
          </button>
          <button type="button" class="btn" onClick={() => send.close()}>
            Cancel
          </button>
        </div>
      </Dialog>
    </WorkingScreen>
  );
}

function PaperPreview({ packet, rows }: { packet: Packet; rows: Observation[] }) {
  const kit = useSelect(app, (s) => s.server.kit);
  const objects = useSelect(app, (s) => s.server.objects);
  const programs = useSelect(app, (s) => s.server.programs);
  const account = useSelect(app, (s) => s.account);
  const [strokes, setStrokes] = useState<Record<string, StrokeFile | null>>({});

  useLayoutEffect(() => {
    let live = true;
    void (async () => {
      const found: Record<string, StrokeFile | null> = {};
      for (const row of packet.rows) {
        if (!row.strokes_sha256) continue;
        const response = await fetch(`/api/packets/${packet.id}/strokes/${row.observation_id}`, { credentials: "same-origin" }).catch(() => null);
        found[row.observation_id] = response?.status === 200 ? parseStrokeFile(await response.text()) : null;
      }
      if (live) setStrokes(found);
    })();
    return () => {
      live = false;
    };
  }, [packet.id, packet.revision]);

  const program = programs?.find((p) => p.id === packet.program_id);
  const pages = useMemo(() => {
    const list: string[] = [""];
    for (let i = 0; i < packet.rows.length; i++) list.push("");
    if (!kit || !objects || !program || !account) return list;
    list[0] = coverPage({
      number: packet.number,
      programName: program.name,
      observerName: account.display_name,
      observerEmail: account.email,
      rowCount: packet.observation_ids.length,
      coordinatorName: program.coordinator_name,
    });
    packet.rows.forEach((row, index) => {
      const obs = rows.find((o) => o.id === row.observation_id);
      if (!obs) return;
      const object = objectOf(objects, obs.object_id);
      const telescope = kit.telescopes.find((t) => t.id === obs.optics.telescope_id);
      const eyepiece = kit.eyepieces.find((e) => e.id === obs.optics.eyepiece_id);
      const barlow = kit.barlows.find((b) => b.id === obs.optics.barlow_id);
      const page: PageObservation = {
        designation: obs.designation,
        objectName: object?.name ?? "",
        kind: obs.kind,
        observedAt: obs.observed_at,
        localTime: obs.local_time,
        localOffset: obs.local_offset,
        timeZone: obs.site.time_zone,
        siteName: obs.site.name,
        seeing: obs.seeing,
        transparencyNelm: obs.transparency_nelm,
        telescopeName: telescope?.name ?? "",
        eyepieceName: eyepiece?.name ?? "",
        barlowName: barlow?.name ?? null,
        derived: obs.derived,
        edition: row.edition,
        concentrationClass: obs.concentration_class,
        pair: obs.pair,
        description: obs.description,
        strokes: strokes[row.observation_id] ?? null,
      };
      list[index + 1] = rowPage(page);
    });
    return list;
  }, [kit, objects, program, account, packet, rows, strokes]);

  return (
    <section role="region" aria-label="Paper preview" class="paper-preview">
      {pages.map((html, i) => (
        <article key={i} class="lp-page" aria-label={`Page ${i + 1} of ${pages.length}`} dangerouslySetInnerHTML={{ __html: html }} />
      ))}
    </section>
  );
}

