import Field from "../components/Field.jsx";
import { api, outageCopy, PERMISSION } from "./api.js";
import { useConsole } from "./context.js";

const PLANS = [["starter", "Starter"], ["team", "Team"], ["scale", "Scale"], ["private", "Private Cloud"]];

export default function Settings() {
  // Preferences and the plan announce in the shell's one "Settings status" region.
  const { admin, user, workspace, savePreferences, refreshWorkspace, report, setSettingsStatus: setStatus } = useConsole();

  const prefer = async (changes) => {
    const result = await savePreferences(changes);
    if (!result.ok) setStatus(result.outage ? outageCopy(result) : PERMISSION);
  };
  const changePlan = async (plan) => {
    setStatus("Saving…");
    const result = await api("/api/workspace", { method: "PATCH", body: { plan } });
    if (result.ok) {
      setStatus("Plan updated");
      refreshWorkspace();
    } else {
      setStatus(result.outage ? outageCopy(result) : PERMISSION);
      report(result);
    }
  };

  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>
      <div className="split">
        <section className="panel form-grid" aria-labelledby="prefs-title">
          <h2 id="prefs-title" className="panel-title">Preferences</h2>
          <fieldset className="choice">
            <legend className="field-label">Console theme</legend>
            {[["light", "Light"], ["dark", "Dark"]].map(([value, label]) => (
              <label className="check" key={value}>
                <input type="radio" name="theme" checked={user.preferences.theme === value} onChange={() => prefer({ theme: value })} />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={user.preferences.sync_sounds} onChange={(e) => prefer({ sync_sounds: e.target.checked })} />
            Play a chime when a sync ends
          </label>
        </section>
        {admin && workspace && (
          <section className="panel form-grid" aria-labelledby="plan-title">
            <h2 id="plan-title" className="panel-title">Workspace plan</h2>
            <Field label="Plan" hint={`Schedules may run every ${workspace.min_interval_minutes} minutes at most often.`}>
              {(control) => (
                <select {...control} className="select" value={workspace.plan} onChange={(e) => changePlan(e.target.value)}>
                  {PLANS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              )}
            </Field>
          </section>
        )}
      </div>
    </div>
  );
}
