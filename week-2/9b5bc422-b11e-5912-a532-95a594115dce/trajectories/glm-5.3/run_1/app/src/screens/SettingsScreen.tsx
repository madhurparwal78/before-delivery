import { useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/app';
import { Dialog } from '../components/ui';
import type { DeviceInfo } from '../../shared/domain';

export function SettingsScreen() {
  const colourScheme = useApp((s) => s.colourScheme);
  const setColourScheme = useApp((s) => s.setColourScheme);
  const signedIn = useApp((s) => s.signedIn);
  const email = useApp((s) => s.email);
  const signOut = useApp((s) => s.signOut);
  const syncingOn = useApp((s) => s.syncingOn);
  const uploadChosen = useApp((s) => s.uploadChosen);
  const chooseUpload = useApp((s) => s.chooseUpload);
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [removeDevice, setRemoveDevice] = useState<DeviceInfo | null>(null);
  const removeOpenerRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [removedNotice, setRemovedNotice] = useState(false);

  // A device whose session has ended sees the published notice at its next
  // request.
  useEffect(() => {
    if (!signedIn) return;
    void fetch('/api/devices')
      .then(async (res) => {
        if (res.status === 401) {
          setRemovedNotice(true);
          await useApp.getState().clearSession();
          return;
        }
        if (res.ok) {
          const body = await res.json();
          setDevices(body.devices);
        }
      })
      .catch(() => {
        // offline: the device list stays as it was
      });
  }, [signedIn, syncingOn]);

  const doRemove = async (device: DeviceInfo) => {
    setPending(true);
    try {
      const res = await fetch(`/api/devices/${device.id}`, { method: 'DELETE' });
      if (res.ok) {
        setDevices((d) => d?.filter((x) => x.id !== device.id) ?? null);
        useApp.getState().announce(`Removed ${device.name}.`);
      }
    } finally {
      setPending(false);
      setRemoveDevice(null);
      removeOpenerRef.current?.focus();
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="heading-row">
        <h1>Settings</h1>
      </div>
      <section className="paper" style={{ padding: 16, marginBottom: 16 }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>Colour scheme</h2>
        <div role="radiogroup" aria-label="Colour scheme" style={{ display: 'flex', gap: 8 }}>
          {(['Light', 'Dark', 'System'] as const).map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={colourScheme === s}
              className="button"
              style={colourScheme === s ? { borderColor: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent)' } : undefined}
              onClick={() => setColourScheme(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </section>
      <section className="paper" style={{ padding: 16, marginBottom: 16 }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>Account</h2>
        {signedIn ? (
          <>
            <p style={{ margin: '0 0 8px' }}>{email}</p>
            <button className="button" onClick={() => void signOut()}>Sign out</button>
            {uploadChosen && !syncingOn && (
              <button className="button" style={{ marginLeft: 8 }} onClick={() => void chooseUpload()}>
                Upload this workspace
              </button>
            )}
          </>
        ) : (
          <p style={{ margin: 0 }}>You are not signed in. This workspace stays on this device.</p>
        )}
      </section>
      {signedIn && (
        <section className="paper" style={{ padding: 16 }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>Devices</h2>
          {devices === null ? (
            <p style={{ margin: 0 }} className="meta">Loading...</p>
          ) : (
            <ul role="list" aria-label="Devices" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {devices.map((d) => (
                <li key={d.id} className="list-row" style={{ border: 'none' }}>
                  <span>{d.name}{d.current ? ' (This device)' : ''}</span>
                  {!d.current && (
                    <button
                      ref={removeOpenerRef}
                      className="button"
                      aria-label={`Remove ${d.name}`}
                      onClick={() => setRemoveDevice(d)}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {removeDevice && (
        <Dialog
          label="Remove device"
          onClose={() => {
            setRemoveDevice(null);
            removeOpenerRef.current?.focus();
          }}
        >
          <h2>Remove device</h2>
          <p>Remove {removeDevice.name} from your account? Its session ends at its next request.</p>
          <div className="row">
            <button className="button" onClick={() => { setRemoveDevice(null); removeOpenerRef.current?.focus(); }}>Cancel</button>
            <button className="button accent-button" disabled={pending} onClick={() => void doRemove(removeDevice)}>
              {pending ? 'Removing...' : 'Remove device'}
            </button>
          </div>
        </Dialog>
      )}
      {removedNotice && (
        <div className="notice" role="region" aria-label="Notices">
          <span>This device was removed from your account. Your work here stays on this device.</span>
          <button className="button" onClick={() => setRemovedNotice(false)}>Dismiss notice</button>
        </div>
      )}
    </div>
  );
}
