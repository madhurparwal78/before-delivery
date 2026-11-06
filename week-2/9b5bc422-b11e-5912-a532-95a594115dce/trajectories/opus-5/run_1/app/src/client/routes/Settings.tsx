import { useEffect, useState } from 'react';
import { announce as copy, pending } from '../../domain/copy.ts';
import { Dialog } from '../components/Dialog.tsx';
import { useStore } from '../hooks.ts';
import { announce, setPrefs } from '../store/store.ts';
import { account, devices } from '../store/sync.ts';
import type { ColourScheme } from '../store/prefs.ts';

type DeviceView = { id: string; name: string; current: boolean; lastSeenAt: string };

export function Settings() {
  const state = useStore();
  const [list, setList] = useState<DeviceView[]>([]);
  const [removing, setRemoving] = useState<DeviceView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state.account) {
      setList([]);
      return;
    }
    void devices.list().then(setList);
  }, [state.account, state.version]);

  const schemes: ColourScheme[] = ['Light', 'Dark', 'System'];

  return (
    <div className="screen settings-screen">
      <h1 className="display">Settings</h1>

      <div role="radiogroup" aria-label="Colour scheme" className="scheme-choice">
        {schemes.map((scheme) => (
          <button
            key={scheme}
            type="button"
            role="radio"
            aria-checked={state.prefs.scheme === scheme}
            tabIndex={state.prefs.scheme === scheme ? 0 : -1}
            className="button"
            onClick={() => setPrefs({ scheme })}
          >
            {scheme}
          </button>
        ))}
      </div>

      {state.account && (
        <section className="paper settings-account">
          <h2 className="display">Account</h2>
          <p>{state.account.user.email}</p>
          {state.choiceMade && state.syncMode === 'off' && (
            <button type="button" className="button" onClick={() => void account.chooseUpload()}>
              Upload this workspace
            </button>
          )}
          <button type="button" className="button" onClick={() => void account.signOut()}>
            Sign out
          </button>

          <h2 className="display">Devices</h2>
          <ul aria-label="Devices" className="devices">
            {list.map((device) => (
              <li key={device.id}>
                <span>{device.current ? `${device.name} This device` : device.name}</span>
                {!device.current && (
                  <button
                    type="button"
                    className="button"
                    aria-label={`Remove ${device.name}`}
                    onClick={() => setRemoving(device)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {removing && (
        <Dialog name="Remove device" onClose={() => setRemoving(null)}>
          <h2 className="display">Remove device</h2>
          <p>{`Remove ${removing.name} from your account?`}</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              data-autofocus
              disabled={busy}
              onClick={() => {
                const target = removing;
                setBusy(true);
                void devices.remove(target.id).then(async (result) => {
                  setBusy(false);
                  if (result.status === 204) {
                    announce(copy.deviceRemoved(target.name));
                    setRemoving(null);
                    setList(await devices.list());
                  }
                });
              }}
            >
              {busy ? pending.removing : 'Remove device'}
            </button>
            <button type="button" className="button" onClick={() => setRemoving(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
