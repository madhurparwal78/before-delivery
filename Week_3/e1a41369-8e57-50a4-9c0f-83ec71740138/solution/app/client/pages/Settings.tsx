import { useState, type FormEvent } from "react";
import { api, explain, fieldErrors } from "../api";
import { setState, useStore } from "../store";

const ZONES = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC")];

export function Settings() {
  const me = useStore((state) => state.me)!;
  const [timeZone, setTimeZone] = useState(me.timeZone);
  const [hour, setHour] = useState(String(me.dayStartHour));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setSaved(false);
    setErrors({});
    try {
      const player = await api<typeof me>("PATCH", "/api/settings", { timeZone, dayStartHour: hour === "" ? null : Number(hour) });
      setState({ me: player });
      setSaved(true);
    } catch (error) {
      const invalid = fieldErrors(error);
      if (invalid) setErrors(invalid);
      else setState({ alert: explain(error) });
    } finally {
      setPending(false);
    }
  };

  const toggleRest = async (resting: boolean): Promise<void> => {
    setState({ me: { ...me, resting } });
    try {
      await api("PATCH", "/api/settings", { resting });
    } catch (error) {
      setState({ me: { ...me, resting: !resting }, alert: explain(error) });
    }
  };

  return (
    <main className="page">
      <section className="page-head"><h1 className="page-title">Settings</h1></section>
      <form className="page-body form form-wide" onSubmit={(event) => void save(event)}>
        <label className="field-label" htmlFor="zone">Time zone</label>
        <select id="zone" value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
          {ZONES.map((zone) => (
            <option key={zone} value={zone}>{zone}</option>
          ))}
        </select>
        {errors.timeZone && <p className="field-error" role="alert">{errors.timeZone}</p>}
        <label className="field-label" htmlFor="day-start">Day start hour</label>
        <input id="day-start" type="number" min={0} max={23} step={1} value={hour} onChange={(event) => setHour(event.target.value)} />
        {errors.dayStartHour && <p className="field-error" role="alert">{errors.dayStartHour}</p>}
        <p className="next-start">{`Next day start: ${me.nextDayStart}`}</p>
        <div className="form-actions">
          <button type="submit" className="btn btn-accent" disabled={pending}>Save settings</button>
        </div>
        {saved && <p className="success" role="status">Settings saved.</p>}
      </form>
      <section className="page-rest">
        <label className="switch">
          <input type="checkbox" role="switch" aria-label="Rest mode" checked={me.resting} onChange={(event) => void toggleRest(event.target.checked)} />
          <span>Rest mode</span>
          <span className="switch-state" aria-hidden="true">{me.resting ? "On" : "Off"}</span>
        </label>
        <p>Turn it on before a trip. Your days still close, but missed dailies cost you nothing and the boss does not strike you.</p>
      </section>
    </main>
  );
}
