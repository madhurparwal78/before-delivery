import { useId, useState, type KeyboardEvent } from "react";
import { CATEGORIES, type Category, type NightSettings } from "../../shared/api";
import { api, deviceId, succeeded } from "../api";
import { CATEGORY_LABEL, COPY, DRILL_PROMPT } from "../copy";
import { Dialog } from "../ui/dialog";
import { FieldError } from "../ui/Status";
import { useTimeZones } from "../zones";

interface TagDialogProps {
  open: boolean;
  phrase: string;
  returnFocus: () => HTMLElement | null;
  onCancel: () => void;
  onConfirm: (category: Category) => void;
}

export function TagDialog({ open, phrase, returnFocus, onCancel, onConfirm }: TagDialogProps) {
  const [category, setCategory] = useState<Category>("inner_awareness");
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onConfirm(category);
    }
  };
  return (
    <Dialog open={open} title="Tag dream sign" onDismiss={onCancel} returnFocus={returnFocus}>
      <p className="phrase">Phrase: "{phrase}"</p>
      <div role="radiogroup" aria-label="Category" className="choices" onKeyDown={onKeyDown}>
        {CATEGORIES.map((option) => (
          <label key={option} className="choice">
            <input type="radio" name="sign-category" value={option} checked={category === option} onChange={() => setCategory(option)} />
            {CATEGORY_LABEL[option]}
          </label>
        ))}
      </div>
      <div className="dialog-actions">
        <button type="button" className="button primary" onClick={() => onConfirm(category)}>
          Confirm tag
        </button>
        <button type="button" className="button quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

const STEPS = 3;

interface DrillDialogProps {
  open: boolean;
  target: Category;
  returnFocus: () => HTMLElement | null;
  onClose: () => void;
  onLogged: (nightCount: number) => void;
}

/** The three-step reality check against the drill target, logged once per device-made id. */
export function DrillDialog({ open, target, returnFocus, onClose, onLogged }: DrillDialogProps) {
  const [step, setStep] = useState(1);
  const [checkId] = useState(deviceId);
  const [logging, setLogging] = useState(false);
  const [problem, setProblem] = useState("");
  const text = step === 1 ? DRILL_PROMPT[target] : step === 2 ? COPY.drillQuestion : COPY.drillCheck;
  const log = async () => {
    setLogging(true);
    setProblem("");
    try {
      const result = await api<{ night_count: number }>("POST", "/api/me/reality-checks", { id: checkId, category: target });
      if (succeeded(result.status)) {
        onLogged(result.data.night_count);
        return;
      }
      setProblem("The reality check was not logged. Try again.");
    } catch {
      setProblem(COPY.needsConnection);
    } finally {
      setLogging(false);
    }
  };
  return (
    <Dialog open={open} title="Reality check drill" onDismiss={onClose} returnFocus={returnFocus}>
      <p className="drill-count">{`Step ${step} of ${STEPS}`}</p>
      <p className="drill-step">{text}</p>
      {problem ? <p className="field-error">{problem}</p> : null}
      <div className="dialog-actions">
        {step < STEPS ? (
          <button type="button" className="button primary" onClick={() => setStep(step + 1)}>
            Next
          </button>
        ) : (
          <button type="button" className="button primary" disabled={logging} onClick={() => void log()}>
            Log reality check
          </button>
        )}
        <button type="button" className="button quiet" onClick={onClose}>
          Close drill
        </button>
      </div>
    </Dialog>
  );
}

interface SettingsDialogProps {
  open: boolean;
  homeTz: string;
  bedtime: string;
  returnFocus: () => HTMLElement | null;
  onClose: () => void;
  onSaved: (settings: NightSettings) => void;
}

export function SettingsDialog({ open, homeTz, bedtime, returnFocus, onClose, onSaved }: SettingsDialogProps) {
  const ids = { zone: useId(), bedtime: useId(), zoneError: useId(), bedtimeError: useId() };
  const [zone, setZone] = useState(homeTz);
  const [time, setTime] = useState(bedtime);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const zones = useTimeZones();
  const save = async () => {
    setSaving(true);
    try {
      const result = await api<NightSettings>("PATCH", "/api/me/settings", { home_tz: zone, bedtime: time });
      if (result.status === 200) onSaved(result.data);
      else setErrors(result.data.errors ?? {});
    } catch {
      setErrors({ bedtime: COPY.needsConnection });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} title="Night settings" onDismiss={onClose} returnFocus={returnFocus}>
      <div className="field">
        <label htmlFor={ids.zone}>Home time zone</label>
        <select id={ids.zone} className="input" value={zone} aria-describedby={errors.home_tz ? ids.zoneError : undefined} onChange={(e) => setZone(e.target.value)}>
          {(zones ?? [homeTz]).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <FieldError id={ids.zoneError} message={errors.home_tz} />
      </div>
      <div className="field">
        <label htmlFor={ids.bedtime}>Usual bedtime</label>
        <input id={ids.bedtime} className="input" inputMode="numeric" placeholder="22:30" value={time} aria-describedby={errors.bedtime ? ids.bedtimeError : undefined} onChange={(e) => setTime(e.target.value)} />
        <p className="hint">24-hour time, between 20:00 and 23:59.</p>
        <FieldError id={ids.bedtimeError} message={errors.bedtime} />
      </div>
      <div className="dialog-actions">
        <button type="button" className="button primary" disabled={saving} onClick={() => void save()}>
          Save settings
        </button>
        <button type="button" className="button quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
