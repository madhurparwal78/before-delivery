// Filing a ladder report from the deck or the pilot boat. A photo counts only once the store has
// confirmed it; a refused photo stays on the device with a retry, and choosing another replaces it.
import { useState } from "react";
import { DEFECTS, type LadderReport, type Move, type StoredPhoto } from "../../shared/types";
import { NO_REPLY, request, useKeyedControl } from "../api";
import { countCopy, FormErrors, type FieldErrors } from "../ui/FormErrors";
import { LiveRegion, useLive } from "../ui/live";
import { Panel } from "../ui/Panel";

interface Unstored {
  file: File;
}

const UPLOAD_COPY: Record<number, string> = {
  413: "Photo is over 5,000,000 bytes.",
  415: "Photo is not a JPEG, PNG or WebP image.",
  503: "Evidence store unreachable - photo kept on this device, retry when it returns.",
};

const FIELD_IDS: Record<string, string> = { compliant: "ladder-compliant", defects: "ladder-defects", refuse_boarding: "ladder-refuse", note: "ladder-note" };

export function LadderReportDialog({ move, open, onClose, onFiled }: { move: Move; open: boolean; onClose: () => void; onFiled: () => void }) {
  const [compliant, setCompliant] = useState<boolean | null>(null);
  const [location, setLocation] = useState<"deck" | "pilot_boat">("deck");
  const [defects, setDefects] = useState<string[]>([]);
  const [refuse, setRefuse] = useState(false);
  const [note, setNote] = useState("");
  const [stored, setStored] = useState<StoredPhoto[]>([]);
  const [unstored, setUnstored] = useState<Unstored | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const announcements = useLive();
  const fileControl = useKeyedControl();

  const upload = async (file: File): Promise<void> => {
    setUnstored(null);
    announcements.say("Uploading photo...");
    const outcome = await request<StoredPhoto>(`/api/moves/${encodeURIComponent(move.ref)}/photos`, { raw: file });
    if (outcome.kind === "ok") {
      setStored((list) => [...list, { photo_id: outcome.data.photo_id, sha256: outcome.data.sha256, size_bytes: outcome.data.size_bytes }]);
      announcements.say(`Photo stored. SHA-256 ${outcome.data.sha256}`);
      return;
    }
    setUnstored({ file });
    announcements.say(outcome.kind === "no-reply" ? NO_REPLY : (UPLOAD_COPY[outcome.status] ?? UPLOAD_COPY[415] ?? ""));
  };

  const file = async (): Promise<void> => {
    const body = { compliant: compliant ?? undefined, defects, refuse_boarding: refuse, location, note, photo_ids: stored.map((p) => p.photo_id) };
    const key = fileControl.begin(body);
    if (key === null) return;
    announcements.say("Filing report...");
    const outcome = await request<LadderReport>(`/api/moves/${encodeURIComponent(move.ref)}/ladder-reports`, { body, key });
    fileControl.end(outcome);
    if (outcome.kind === "no-reply") {
      announcements.say(NO_REPLY);
      return;
    }
    if (outcome.kind === "ok") {
      setErrors({});
      announcements.say(`Report ${outcome.data.id} filed`);
      onFiled();
      return;
    }
    const found = outcome.error.errors ?? { form: outcome.error.message };
    setErrors(found);
    announcements.say(countCopy(found));
  };

  return (
    <Panel open={open} label="Ladder report" variant="dialog" onClose={onClose}>
      <header className="panel-head">
        <h2>Ladder report</h2>
        <p className="muted">
          {move.ref} · {move.vessel.name}
        </p>
      </header>
      <form
        className="panel-body"
        onSubmit={(event) => {
          event.preventDefault();
          void file();
        }}
      >
        <FormErrors errors={errors} fieldIds={FIELD_IDS} />
        <fieldset role="radiogroup" aria-label="Ladder state" className="choice" id="ladder-compliant" tabIndex={-1}>
          <legend>Ladder state</legend>
          <label>
            <input type="radio" name="ladder-state" checked={compliant === true} onChange={() => setCompliant(true)} /> Compliant
          </label>
          <label>
            <input type="radio" name="ladder-state" checked={compliant === false} onChange={() => setCompliant(false)} /> Non-compliant
          </label>
        </fieldset>
        <fieldset role="radiogroup" aria-label="Filed from" className="choice">
          <legend>Filed from</legend>
          <label>
            <input type="radio" name="filed-from" checked={location === "deck"} onChange={() => setLocation("deck")} /> Deck
          </label>
          <label>
            <input type="radio" name="filed-from" checked={location === "pilot_boat"} onChange={() => setLocation("pilot_boat")} /> Pilot boat
          </label>
        </fieldset>
        <fieldset role="group" aria-label="Defects" className="defects" id="ladder-defects" tabIndex={-1}>
          <legend>Defects</legend>
          {DEFECTS.map((d) => (
            <label key={d.code}>
              <input
                type="checkbox"
                checked={defects.includes(d.code)}
                onChange={(e) => setDefects((list) => (e.target.checked ? [...list, d.code] : list.filter((c) => c !== d.code)))}
              />{" "}
              {d.name}
            </label>
          ))}
        </fieldset>
        <label className="check" id="ladder-refuse">
          <input type="checkbox" checked={refuse} onChange={(e) => setRefuse(e.target.checked)} /> Refuse boarding
        </label>
        <label className="field">
          <span>Report note</span>
          <textarea id="ladder-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="field">
          <span>Ladder photo</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              e.target.value = "";
              if (chosen) void upload(chosen);
            }}
          />
        </label>
        <ul className="photos" aria-label="Chosen photos">
          {stored.map((p, i) => (
            <li key={p.photo_id}>
              Photo {i + 1}: Photo stored <span className="num hash">SHA-256 {p.sha256}</span>
            </li>
          ))}
          {unstored ? (
            <li className="short">
              {unstored.file.name}: Photo not stored{" "}
              <button type="button" className="ghost small" onClick={() => void upload(unstored.file)}>
                Retry photo upload
              </button>
            </li>
          ) : null}
        </ul>
        <div className="panel-actions">
          <button type="submit" className="primary">
            File report
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Close report
          </button>
        </div>
        <LiveRegion name="Report announcements" live={announcements} />
      </form>
    </Panel>
  );
}
