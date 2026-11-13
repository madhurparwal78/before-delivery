// The firing control strip: status and times from the server, New firing, Start firing and Unload,
// with the New firing and Unload firing dialogs.
import { useState } from "react";
import type { Firing, Kiln } from "../../shared/api";
import { request, uploadPhoto } from "../api";
import { Dialog } from "../components/Dialog";
import { Status } from "../components/Status";

type Say = (text: string, tone?: "ok" | "error" | "") => void;

function NewFiringDialog({ kiln, onClose, onDone, say }: { kiln: Kiln; onClose: () => void; onDone: () => void; say: Say }) {
  const [profileId, setProfileId] = useState(kiln.profiles[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="New firing" onClose={onClose}>
      {(close) => {
        const create = async () => {
          setBusy(true);
          say("Creating firing…");
          const result = await request<Firing>("POST", "/api/firings", { kiln_id: kiln.id, profile_id: profileId });
          setBusy(false);
          if (result.ok) say(`Firing created with ${result.data.profile.name}.`, "ok");
          else if (result.error?.error === "kiln_busy") say("This kiln already has a firing in progress.", "error");
          else say(result.error?.message ?? "Not saved — the studio server is unreachable.", "error");
          onDone();
          close();
        };
        return (
          <>
            <p className="muted">
              A new load on <strong>{kiln.name}</strong>. The profile sets the stage, the cone and the schedule.
            </p>
            <div className="field">
              <label htmlFor="new-firing-profile">Profile</label>
              <select id="new-firing-profile" className="select" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                {kiln.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy}>
                Create firing
              </button>
              <button type="button" className="btn" onClick={close}>
                Cancel
              </button>
            </div>
          </>
        );
      }}
    </Dialog>
  );
}

interface DamageDraft {
  checked: boolean;
  kind: "glaze_run" | "crack";
  note: string;
  photo: { kind: "none" } | { kind: "uploading" } | { kind: "attached"; id: string } | { kind: "error"; message: string };
}

function UnloadDialog({ firing, onClose, onDone, say }: { firing: Firing; onClose: () => void; onDone: () => void; say: Say }) {
  const numbers = firing.layers.flatMap((layer) => layer.placements.map((p) => p.piece_number)).sort();
  const [shelf, setShelf] = useState("");
  const [damage, setDamage] = useState<Record<string, DamageDraft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const draftOf = (n: string): DamageDraft => damage[n] ?? { checked: false, kind: "glaze_run", note: "", photo: { kind: "none" } };
  const update = (n: string, change: Partial<DamageDraft>) => setDamage((d) => ({ ...d, [n]: { ...draftOf(n), ...change } }));

  const choose = async (n: string, file: File | undefined) => {
    if (!file) return;
    update(n, { photo: { kind: "uploading" } });
    const result = await uploadPhoto(file);
    setDamage((d) => ({
      ...d,
      [n]: {
        ...(d[n] ?? draftOf(n)),
        photo: result.ok
          ? { kind: "attached", id: result.data.photo_id }
          : { kind: "error", message: result.status === 415 ? "Use a JPEG, PNG, WebP or HEIC photo" : result.status === 413 ? "Photo is over 8,000,000 bytes" : "Photo not saved — storage is unreachable. Try again in a minute." },
      },
    }));
  };

  return (
    <Dialog title="Unload firing" onClose={onClose} wide>
      {(close) => {
        const confirmUnload = async () => {
          setBusy(true);
          setErrors({});
          say("Unloading…");
          const entries = numbers
            .filter((n) => draftOf(n).checked)
            .map((n) => {
              const d = draftOf(n);
              return { piece_number: n, kind: d.kind, photo_id: d.photo.kind === "attached" ? d.photo.id : null, note: d.note };
            });
          const result = await request<Firing>("POST", `/api/firings/${firing.id}/unload`, { pickup_shelf: shelf.trim(), damage: entries });
          setBusy(false);
          if (result.ok) {
            say("Firing unloaded. Pickup notices are on their way.", "ok");
            onDone();
            close();
            return;
          }
          if (result.status === 422 && result.error?.fields) {
            const fields: Record<string, string> = {};
            for (const [key, message] of Object.entries(result.error.fields)) {
              const match = /^damage\.(\d+)\.(\w+)$/.exec(key);
              fields[match ? `${entries[Number(match[1])]?.piece_number}.${match[2]}` : key] = message;
            }
            setErrors(fields);
            say(fields.pickup_shelf ?? Object.values(fields)[0] ?? "Check the unload details.", "error");
            return;
          }
          say(result.error?.message ?? "Not saved — the studio server is unreachable.", "error");
          onDone();
        };
        return (
          <>
            <div className="field">
              <label htmlFor="unload-shelf">Pickup shelf</label>
              <input
                id="unload-shelf"
                className="input num"
                value={shelf}
                autoComplete="off"
                maxLength={8}
                onChange={(e) => setShelf(e.target.value.toUpperCase())}
                aria-invalid={errors.pickup_shelf ? true : undefined}
                aria-describedby={errors.pickup_shelf ? "unload-shelf-error" : "unload-shelf-hint"}
              />
              {errors.pickup_shelf ? (
                <p className="field-error" id="unload-shelf-error">
                  {errors.pickup_shelf}
                </p>
              ) : (
                <p className="hint" id="unload-shelf-hint">
                  1 to 8 capital letters or digits, such as B3.
                </p>
              )}
            </div>
            <fieldset className="damage-list">
              <legend>Damage at unload</legend>
              {numbers.map((n) => {
                const d = draftOf(n);
                return (
                  <div key={n} className="damage-entry">
                    <label className="check">
                      <input type="checkbox" checked={d.checked} onChange={(e) => update(n, { checked: e.target.checked })} />
                      Report damage on Piece {n}
                    </label>
                    {d.checked ? (
                      <div className="damage-fields">
                        <div className="choices" role="radiogroup" aria-label={`Damage on Piece ${n}`}>
                          {(
                            [
                              ["glaze_run", "Glaze run"],
                              ["crack", "Crack"],
                            ] as const
                          ).map(([value, label]) => (
                            <label className="choice" key={value}>
                              <input type="radio" name={`damage-kind-${n}`} checked={d.kind === value} onChange={() => update(n, { kind: value })} />
                              {label}
                            </label>
                          ))}
                        </div>
                        <div className="field">
                          <label htmlFor={`damage-photo-${n}`}>Damage photo for Piece {n}</label>
                          <input id={`damage-photo-${n}`} className="photo-input" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/*" capture="environment" onChange={(e) => void choose(n, e.target.files?.[0])} />
                          <p className={`result small${d.photo.kind === "error" ? " is-error" : ""}`} role="status" aria-label={`Damage photo upload for Piece ${n}`}>
                            {d.photo.kind === "uploading" ? "Uploading photo…" : d.photo.kind === "attached" ? "Photo attached" : d.photo.kind === "error" ? d.photo.message : ""}
                          </p>
                          {errors[`${n}.photo_id`] ? <p className="field-error">{errors[`${n}.photo_id`]}</p> : null}
                        </div>
                        <div className="field">
                          <label htmlFor={`damage-note-${n}`}>Damage note</label>
                          <textarea id={`damage-note-${n}`} className="input" rows={2} maxLength={500} value={d.note} onChange={(e) => update(n, { note: e.target.value })} />
                          {errors[`${n}.note`] ? <p className="field-error">{errors[`${n}.note`]}</p> : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </fieldset>
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={() => void confirmUnload()} disabled={busy}>
                Confirm unload
              </button>
              <button type="button" className="btn btn-quiet" onClick={close}>
                Cancel
              </button>
            </div>
          </>
        );
      }}
    </Dialog>
  );
}

export function FiringStrip({ kiln, firing, stale, onChanged }: { kiln: Kiln; firing: Firing | null; stale: boolean; onChanged: () => void }) {
  const [result, setResult] = useState<{ text: string; tone: string }>({ text: "", tone: "" });
  const [dialog, setDialog] = useState<"new" | "unload" | null>(null);
  const [busy, setBusy] = useState(false);
  const say: Say = (text, tone = "") => setResult({ text, tone });

  const status = firing?.status ?? null;
  const unloadable = status === "unloadable";
  const started = status === "firing" || status === "cooling" || status === "unloadable";
  const notCool = status === "firing" ? "Kiln still firing" : status === "cooling" ? "Kiln still cooling" : null;

  const start = async () => {
    if (!firing || busy) return;
    setBusy(true);
    say("Starting firing…");
    const r = await request<Firing>("POST", `/api/firings/${firing.id}/start`, {});
    setBusy(false);
    if (r.ok) say(`Firing started. Unload opens ${r.data.cool_until_label}.`, "ok");
    else if (r.error?.error === "empty_load") say("Place at least one piece before starting.", "error");
    else say(r.error?.message ?? "Not saved — the studio server is unreachable.", "error");
    onChanged();
  };

  return (
    <section className="firing-strip" aria-labelledby="firing-strip-title">
      <h2 id="firing-strip-title" className="visually-hidden">
        Firing
      </h2>
      <div className="strip-status">
        <div role="status" aria-label="Firing status" className="firing-status">
          {firing ? <Status status={firing.status} label={firing.status_label} /> : <Status status={null} label="No firing on this kiln" />}
          {firing && started && status === "firing" ? (
            <span className="time">
              Firing ends <span className="num">{firing.firing_ends_at_label}</span>
            </span>
          ) : null}
          {firing && started ? (
            <span className="time">
              Unload opens <span className="num">{firing.cool_until_label}</span>
            </span>
          ) : null}
          {firing ? <span className="muted small profile-note">{firing.profile.name}</span> : null}
        </div>
        {stale ? <p className="small muted refresh-note">Board not refreshed — retrying.</p> : null}
      </div>
      <div className="strip-actions">
        <button type="button" className="btn" onClick={() => setDialog("new")}>
          New firing
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={!firing || started || busy}>
          Start firing
        </button>
        <span className="unload-wrap">
          <button
            type="button"
            className="btn"
            aria-disabled={unloadable ? undefined : true}
            aria-describedby={notCool ? "unload-note" : undefined}
            onClick={() => unloadable && setDialog("unload")}
          >
            Unload
          </button>
          {notCool && firing ? (
            <span id="unload-note" className="small unload-note">
              {notCool} · Unload opens <span className="num">{firing.cool_until_label}</span>
            </span>
          ) : null}
        </span>
      </div>
      <p role="status" aria-label="Firing result" className={`result${result.tone ? ` is-${result.tone}` : ""}`}>
        {result.text}
      </p>
      {dialog === "new" ? <NewFiringDialog kiln={kiln} onClose={() => setDialog(null)} onDone={onChanged} say={say} /> : null}
      {dialog === "unload" && firing ? <UnloadDialog firing={firing} onClose={() => setDialog(null)} onDone={onChanged} say={say} /> : null}
    </section>
  );
}
