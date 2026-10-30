// Drop detail at /desk/drops/<id> (brief: Screens and layout → Drop detail; Journey 5).

import { ArrowLeft, Camera } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { DROP_STATUS_LABELS, NOT_INSPECTED, tierLabel, type Drop } from "../../shared/api.js";
import { frames, humanDate, money } from "../../shared/format.js";
import { get, post } from "../api.js";
import { COPY } from "../copy.js";
import { navigate } from "../hooks.js";
import { Swatch } from "../PlatMap.js";
import { toTenths } from "../strength.js";
import { Dialog } from "../ui/Dialog.js";
import { Button, ErrorSummary, clearEdited, errorFor, fieldErrors, type FieldError } from "../ui/forms.js";
import { DeskHeader, useAction, useSession } from "./session.js";

function tenths(value: number | null): string | null {
  const scaled = toTenths(value);
  return scaled === null ? null : frames(scaled);
}

function ReviewDialog({
  kind,
  open,
  opener,
  drop,
  onClose,
  onDone,
}: {
  kind: "dispute" | "resolve";
  open: boolean;
  opener: HTMLElement | null;
  drop: Drop;
  onClose: () => void;
  onDone: (drop: Drop) => void;
}) {
  const { busy, run } = useAction();
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const field = kind === "dispute" ? "reason" : "note";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await run(kind, {
      pending: kind === "dispute" ? "Sending dispute…" : "Resolving dispute…",
      call: () => post<Drop>(`/api/drops/${drop.id}/${kind}`, { [field]: text }),
      success: (updated) => (kind === "dispute" ? "Dispute sent to the broker." : `Dispute resolved. ${updated.yard_name} is accepted.`),
      then: (updated) => {
        setErrors([]);
        onDone(updated);
      },
    });
    if (!result.ok && result.status === 422) {
      setErrors(fieldErrors(result.error?.fields, { [field]: "review-text" }, "review-text"));
    }
  };
  return (
    <Dialog title={kind === "dispute" ? "Dispute inspection" : "Resolve dispute"} open={open} opener={opener} onClose={onClose}>
      <form onInput={clearEdited(setErrors)} onSubmit={submit} noValidate aria-label={kind === "dispute" ? "Dispute details" : "Resolution details"}>
        <p className="dialog-lede">
          {kind === "dispute"
            ? `Tell the broker what looks wrong with the inspection of ${drop.yard_name}.`
            : `Resolving accepts the inspection of ${drop.yard_name} for ${drop.beekeeper?.name ?? "the beekeeper"}.`}
        </p>
        {kind === "resolve" && drop.dispute_reason ? <blockquote className="quote">{drop.dispute_reason}</blockquote> : null}
        <ErrorSummary errors={errors} />
        <div className="field">
          <label htmlFor="review-text">{kind === "dispute" ? "Reason" : "Resolution note"}</label>
          {errorFor(errors, "review-text") ? (
            <p className="field-error" id="review-text-error">
              {errorFor(errors, "review-text")}
            </p>
          ) : null}
          <textarea
            id="review-text"
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-invalid={errorFor(errors, "review-text") ? true : undefined}
            aria-describedby={errorFor(errors, "review-text") ? "review-text-error" : undefined}
          />
        </div>
        <div className="dialog-actions">
          <Button type="submit" variant="primary" busy={busy === kind}>
            {kind === "dispute" ? "Send dispute" : "Resolve"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function DropDetail({ dropId }: { dropId: string }) {
  const user = useSession();
  const { busy, run } = useAction();
  const [drop, setDrop] = useState<Drop | null>(null);
  const [missing, setMissing] = useState(false);
  const [dialog, setDialog] = useState<{ kind: "dispute" | "resolve"; opener: HTMLElement | null; seq: number } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    const result = await get<Drop>(`/api/drops/${encodeURIComponent(dropId)}`);
    if (result.ok) setDrop(result.data);
    else if (result.status === 401) navigate("/", true);
    else setMissing(true);
  }, [dropId]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  useEffect(() => {
    document.title = drop ? `${drop.yard_name} · Swarmline Bloom Desk` : "Drop · Swarmline Bloom Desk";
  }, [drop]);

  const back = (
    <a
      className="back-link"
      href="/desk"
      onClick={(event) => {
        event.preventDefault();
        navigate(drop ? `/desk?orchard=${encodeURIComponent(drop.orchard.id)}&order=${encodeURIComponent(drop.order.id)}` : "/desk");
      }}
    >
      <ArrowLeft aria-hidden="true" size={18} strokeWidth={1.5} />
      Back to the desk
    </a>
  );

  const groups = new Map<string, Drop["photos"]>();
  for (const photo of drop?.photos ?? []) groups.set(photo.colony_label, [...(groups.get(photo.colony_label) ?? []), photo]);

  if (!user) {
    // no header until the session is known: drawing it without the name would move it when the name arrives
    return (
      <div className="drop-page">
        <p className="loading-line">Reading the drop…</p>
      </div>
    );
  }

  return (
    <div className="drop-page">
      <DeskHeader user={user} />
      <main className="drop-main">
        {back}
        {missing ? (
          <section className="notice">
            <h1>Drop</h1>
            <p>{COPY.notFound}</p>
          </section>
        ) : drop === null ? (
          <p className="loading-line">Reading the drop…</p>
        ) : (
          <>
            <header className="drop-head">
              <h1>{drop.yard_name}</h1>
              <p className="muted">
                {drop.order.ref} · {drop.orchard.name}
                {drop.beekeeper ? ` · ${drop.beekeeper.name}` : ""}
              </p>
              <p className="status-chip">{DROP_STATUS_LABELS[drop.status]}</p>
            </header>
            <div className="drop-grid">
              <dl className="figures drop-figures">
                <div>
                  <dt>Hives</dt>
                  <dd>{drop.hives}</dd>
                </div>
                <div>
                  <dt>Block</dt>
                  <dd>{drop.block?.name ?? "Not yet delivered"}</dd>
                </div>
                <div>
                  <dt>Delivered</dt>
                  <dd>{drop.delivered_on ? humanDate(drop.delivered_on) : "—"}</dd>
                </div>
                <div>
                  <dt>Block tier</dt>
                  <dd className="tier-figure">
                    <Swatch fill={drop.tier ?? "uninspected"} />
                    {drop.block_average_frames === null ? NOT_INSPECTED : `${tierLabel(drop.tier)} · ${tenths(drop.block_average_frames)} frames`}
                  </dd>
                </div>
                <div>
                  <dt>This drop's samples</dt>
                  <dd>{drop.average_frames === null ? "None sampled" : `${tenths(drop.average_frames)} frames average`}</dd>
                </div>
                <div>
                  <dt>Pay per hive</dt>
                  <dd>{drop.pay_per_hive_cents === null ? "—" : money(drop.pay_per_hive_cents)}</dd>
                </div>
                <div>
                  <dt>Expected pay</dt>
                  <dd className="strong-figure">{drop.payout_cents === null ? "—" : money(drop.payout_cents)}</dd>
                </div>
              </dl>
              <section className="photos" aria-labelledby="photos-title">
                <h2 id="photos-title">Sampled colonies</h2>
                {groups.size === 0 ? (
                  <p className="empty">
                    <Camera aria-hidden="true" size={20} strokeWidth={1.5} />
                    <span>No frame photos for this drop.</span>
                  </p>
                ) : (
                  <ul className="photo-list" aria-label="Frame photos">
                    {[...groups.entries()].flatMap(([colony, photos]) =>
                      photos.map((photo, index) => (
                        <li key={photo.id}>
                          <a href={photo.url} target="_blank" rel="noreferrer" aria-label={`Photo, colony ${colony}`}>
                            <img src={photo.url} alt="" width={120} height={90} loading="lazy" />
                            <span>
                              Colony {colony}
                              {photos.length > 1 ? ` · ${index + 1}` : ""}
                            </span>
                          </a>
                        </li>
                      )),
                    )}
                  </ul>
                )}
              </section>
            </div>
            {drop.dispute_reason ? (
              <section className="dispute">
                <h2>Dispute</h2>
                <blockquote className="quote">{drop.dispute_reason}</blockquote>
                {drop.resolution_note ? <p>Resolution: {drop.resolution_note}</p> : null}
              </section>
            ) : null}
            <div className="actions">
              {user?.role === "beekeeper" && drop.status === "inspected" ? (
                <>
                  <Button
                    variant="primary"
                    busy={busy === "accept"}
                    onClick={() =>
                      void run("accept", {
                        pending: "Accepting inspection…",
                        call: () => post<Drop>(`/api/drops/${drop.id}/accept`),
                        success: (updated) => {
                          setDrop(updated);
                          return `Inspection accepted for ${updated.yard_name}.`;
                        },
                      })
                    }
                  >
                    Accept inspection
                  </Button>
                  <Button onClick={(event) => (setDialog({ kind: "dispute", opener: event.currentTarget, seq: Date.now() }), setDialogOpen(true))}>
                    Dispute inspection
                  </Button>
                </>
              ) : null}
              {user?.role === "broker" && drop.status === "disputed" ? (
                <Button variant="primary" onClick={(event) => (setDialog({ kind: "resolve", opener: event.currentTarget, seq: Date.now() }), setDialogOpen(true))}>
                  Resolve dispute
                </Button>
              ) : null}
            </div>
            {dialog ? (
              <ReviewDialog
                key={dialog.seq}
                kind={dialog.kind}
                open={dialogOpen}
                opener={dialog.opener}
                drop={drop}
                onClose={() => setDialogOpen(false)}
                onDone={(updated) => {
                  setDialogOpen(false);
                  setDrop(updated);
                }}
              />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
