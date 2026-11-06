import { useCallback, useEffect, useState } from "react";
import { showConfirmation } from "../store/announcer.ts";
import type { ColourScheme } from "../store/preferences.ts";
import { readScheme } from "../store/preferences.ts";
import { chooseUpload, signOut } from "../store/sync.ts";
import { getMeta, session } from "../store/workspace.ts";
import { Dialog } from "./common.tsx";
import { applyScheme } from "./colourScheme.ts";

type Device = { id: string; name: string; current: boolean };

function Devices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [removing, setRemoving] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const answer = await fetch("/api/devices").catch(() => null);
    if (answer?.ok) setDevices(((await answer.json()) as { devices: Device[] }).devices);
  }, []);
  useEffect(() => void load(), [load]);
  const remove = async (device: Device): Promise<void> => {
    setBusy(true);
    const answer = await fetch(`/api/devices/${device.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    setRemoving(null);
    if (!answer?.ok) return;
    showConfirmation(`Removed ${device.name}.`);
    await load();
  };
  return (
    <>
      <h3>Devices</h3>
      <ul aria-label="Devices" className="device-list">
        {devices.map((device) => (
          <li key={device.id}>
            <span>{device.name}{device.current ? " This device" : ""}</span>
            {!device.current && <button type="button" className="button" aria-label={`Remove ${device.name}`} onClick={() => setRemoving(device)}>Remove</button>}
          </li>
        ))}
      </ul>
      {removing && (
        <Dialog name="Remove device" onClose={() => setRemoving(null)}>
          <p>{removing.name} will be signed out at its next request. Its work stays on it.</p>
          <div className="dialog-actions">
            <button type="button" className="button" disabled={busy} aria-busy={busy} onClick={() => void remove(removing)}>{busy ? "Removing..." : "Remove device"}</button>
            <button type="button" className="button" onClick={() => setRemoving(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function Account() {
  const account = session();
  const [unreachable, setUnreachable] = useState(false);
  if (!account) return <p>Sign in from the top of the screen to use a second device.</p>;
  const kept = getMeta().choices[account.user.id] === "keep";
  return (
    <>
      <p>{account.user.email}</p>
      <div className="dialog-actions">
        {kept && <button type="button" className="button" onClick={() => chooseUpload(account)}>Upload this workspace</button>}
        <button type="button" className="button" onClick={() => void signOut().then((done) => setUnreachable(!done))}>Sign out</button>
      </div>
      {unreachable && <p className="field-error">We could not reach the server. Nothing has changed on this device.</p>}
      <Devices />
    </>
  );
}

export function Settings() {
  const [scheme, setScheme] = useState(readScheme);
  const choose = (next: ColourScheme): void => {
    setScheme(next);
    applyScheme(next);
  };
  return (
    <div className="screen screen-narrow">
      <h1 className="screen-title">Settings</h1>
      <section className="paper settings-panel">
        <h2>Colour scheme</h2>
        <div role="radiogroup" aria-label="Colour scheme" className="segments">
          {(["Light", "Dark", "System"] as const).map((option) => (
            <label key={option} className="segment">
              <input type="radio" name="scheme" checked={scheme === option} onChange={() => choose(option)} />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </section>
      <section className="paper settings-panel">
        <h2>Account</h2>
        <Account />
      </section>
    </div>
  );
}
