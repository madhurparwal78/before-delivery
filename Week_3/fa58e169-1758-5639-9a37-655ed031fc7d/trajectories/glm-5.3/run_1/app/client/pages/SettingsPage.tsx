import { useState } from "react";
import type { JSX } from "react";
import { api, ApiFail, type MeData } from "../lib/api";
import { fieldErrors, s } from "../../common/copy";

export function SettingsPage(props: { me: MeData; onMotion: (value: boolean) => void }): JSX.Element {
  const [name, setName] = useState(props.me.name);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [reduceMotion, setReduceMotion] = useState(props.me.reduceMotion);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invalidField = (target: string) => (field === target ? "true" : undefined);

  return (
    <div className="panel">
      <h2>Settings</h2>
      <div className="field">
        <label htmlFor="settings-name">Name</label>
        <input id="settings-name" value={name} aria-label="Name" aria-invalid={invalidField("name")} onChange={(event) => setName(event.target.value)} />
      </div>
      <button
        type="button"
        className="button-primary"
        aria-busy={busy}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api("/api/me", { method: "PATCH", body: JSON.stringify({ name }) });
            setStatus(s.settingsSaved);
            setError(null);
          } catch (failure) {
            if (failure instanceof ApiFail && failure.status === 422) {
              setError(String(failure.payload.message ?? ""));
              setField(String(failure.payload.field ?? ""));
            }
          }
          setBusy(false);
        }}
      >
        Save profile
      </button>
      <hr />
      <div className="field">
        <label htmlFor="settings-current">Current password</label>
        <input id="settings-current" type="password" value={current} aria-label="Current password" aria-invalid={invalidField("current")} onChange={(event) => setCurrent(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="settings-next">New password</label>
        <input id="settings-next" type="password" value={next} aria-label="New password" aria-invalid={invalidField("next")} onChange={(event) => setNext(event.target.value)} />
      </div>
      <button
        type="button"
        className="button-primary"
        aria-busy={busy}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api("/api/me/password", { method: "POST", body: JSON.stringify({ current, next }) });
            setStatus(s.settingsSaved);
            setError(null);
            setCurrent("");
            setNext("");
          } catch (failure) {
            if (failure instanceof ApiFail && failure.status === 422) {
              setError(String(failure.payload.message ?? ""));
              setField(String(failure.payload.field ?? ""));
            }
          }
          setBusy(false);
        }}
      >
        Change password
      </button>
      <hr />
      <label>
        <input
          type="checkbox"
          checked={reduceMotion}
          aria-label={s.reduceMotion}
          onChange={async (event) => {
            const value = event.target.checked;
            setReduceMotion(value);
            await api("/api/me", { method: "PATCH", body: JSON.stringify({ reduceMotion: value }) });
            props.onMotion(value);
          }}
        />{" "}
        {s.reduceMotion}
      </label>
      <hr />
      <button
        type="button"
        className="button-plain"
        onClick={async () => {
          await api("/api/session", { method: "DELETE" });
          window.location.href = "/signin";
        }}
      >
        {s.signOut}
      </button>
      <p className="status" role="status" aria-live="polite" aria-label="Settings">
        {status}
      </p>
      {error ? (
        <p className="alert" role="alert" aria-label="Settings error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
