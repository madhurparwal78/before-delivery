// Settings: the home clock, the theme, live device sessions, the password and signing out.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, get, rotatingSession, setCsrf } from '../api.ts';
import { Dialog } from '../Dialog.tsx';
import { announce, showAlert } from '../feedback.ts';
import { applyTheme, setZone, useSession } from '../session.ts';
import { useSync } from '../sync.ts';
import type { DeviceSessionJson } from '../types.ts';
import { shortTime } from '../../shared/time.ts';
import type { ThemeName } from '../../shared/tokens.ts';
import '../styles/settings.css';

const THEME_NAMES: Record<ThemeName, string> = { paper: 'Paper', lamplight: 'Lamplight' };

function zones(current: string): string[] {
  const all = Intl.supportedValuesOf('timeZone');
  return all.includes(current) ? all : [current, ...all];
}

export function SettingsPage() {
  const { zone, theme } = useSession();
  const [zoneChoice, setZoneChoice] = useState(zone);
  const [zoneError, setZoneError] = useState('');
  const [sessions, setSessions] = useState<DeviceSessionJson[]>([]);
  const [confirming, setConfirming] = useState<DeviceSessionJson | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sessionsHeading = useRef<HTMLHeadingElement>(null);
  const focusAfter = useRef<string | null | 'heading'>(null);

  useEffect(() => setZoneChoice(zone), [zone]);

  const loadSessions = useCallback(async () => {
    const r = await get<{ sessions: DeviceSessionJson[] }>('/api/sessions');
    if (r.status !== 200) return;
    setSessions((before) => {
      // An item that disappears while its button has focus hands focus to the item after it.
      const active = document.activeElement;
      const focusedId = active instanceof HTMLElement ? active.dataset.sessionId : undefined;
      if (focusedId && !r.data.sessions.some((s) => s.id === focusedId)) {
        const after = before.slice(before.findIndex((s) => s.id === focusedId) + 1).find((s) => !s.current && r.data.sessions.some((x) => x.id === s.id));
        focusAfter.current = after ? after.id : 'heading';
      }
      return r.data.sessions;
    });
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useSync((event) => {
    if (event === 'sessions.changed' || event === 'sync.reset') void loadSessions();
  });

  useLayoutEffect(() => {
    const target = focusAfter.current;
    if (target === null || confirming) return;
    focusAfter.current = null;
    if (target === 'heading') sessionsHeading.current?.focus();
    else document.querySelector<HTMLElement>(`[data-session-id="${target}"]`)?.focus();
  });

  const saveZone = async () => {
    const r = await api<{ home_time_zone: string; errors?: Record<string, string> }>('PUT', '/api/settings', { home_time_zone: zoneChoice });
    if (r.status === 200) {
      setZoneError('');
      setZone(r.data.home_time_zone);
      announce(`Home clock set to ${r.data.home_time_zone}. Today's note now follows it.`);
    } else setZoneError(r.data.errors?.home_time_zone ?? '');
  };

  const saveTheme = async (value: ThemeName) => {
    const r = await api<{ theme: ThemeName }>('PUT', '/api/settings', { theme: value });
    if (r.status !== 200) return;
    applyTheme(r.data.theme);
    announce(`Theme set to ${THEME_NAMES[r.data.theme]}.`);
  };

  const label = (s: DeviceSessionJson): string => `${s.label}, signed in ${shortTime(Date.parse(s.created_at), zone)}`;

  const signOutDevice = async () => {
    const target = confirming;
    if (!target) return;
    const order = sessions.filter((s) => !s.current);
    const after = order.slice(order.findIndex((s) => s.id === target.id) + 1)[0];
    const r = await api('DELETE', `/api/sessions/${target.id}`);
    if (r.status === 204) announce(`Signed out ${target.label}.`);
    else if (r.status === 404) showAlert('That device is already signed out.');
    focusAfter.current = after ? after.id : 'heading';
    setConfirming(null);
    await loadSessions();
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await rotatingSession(() => api<{ csrf_token?: string; errors?: Record<string, string> }>('POST', '/api/account/password', { current_password: current, new_password: next }));
    if (r.status === 200 && r.data.csrf_token) {
      setCsrf(r.data.csrf_token);
      setErrors({});
      setCurrent('');
      setNext('');
      announce('Password changed. Your other devices are signed out.');
      void loadSessions();
    } else if (r.status === 422) {
      const errs = r.data.errors ?? {};
      setErrors(errs);
      document.getElementById(errs.current_password ? 'current-password' : 'new-password')?.focus();
    }
  };

  const signOut = async () => {
    await api('POST', '/api/auth/sign-out');
    window.location.assign('/sign-in');
  };

  return (
    <div className="settings">
      <h1 tabIndex={-1}>Settings</h1>

      <section className="settings-section" aria-labelledby="clock-head">
        <h2 id="clock-head" className="section-head">Home clock</h2>
        <p className="muted">Today's note, dates and every expiry are read on this clock.</p>
        <div className="settings-row">
          <div className="field">
            <label htmlFor="home-clock">Home clock</label>
            <select id="home-clock" value={zoneChoice} onChange={(e) => setZoneChoice(e.target.value)} aria-describedby={zoneError ? 'home-clock-error' : undefined}>
              {zones(zoneChoice).map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
            {zoneError && <p id="home-clock-error" className="field-error">{zoneError}</p>}
          </div>
          <button type="button" className="primary" onClick={() => void saveZone()}>Save home clock</button>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="theme-head">
        <h2 id="theme-head" className="section-head">Theme</h2>
        <div className="field">
          <label htmlFor="theme">Theme</label>
          <select id="theme" key={theme} defaultValue={theme} onChange={(e) => void saveTheme(e.target.value as ThemeName)}>
            <option value="paper">Paper</option>
            <option value="lamplight">Lamplight</option>
          </select>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="sessions-head">
        <h2 id="sessions-head" className="section-head" ref={sessionsHeading} tabIndex={-1}>Device sessions</h2>
        <ul aria-labelledby="sessions-head" className="sessions">
          {sessions.map((s) => (
            <li key={s.id}>
              <span>{label(s)}</span>
              {s.current ? (
                <span className="this-device small-caps">This device</span>
              ) : (
                <button type="button" className="quiet" data-session-id={s.id} aria-label={`Sign out ${label(s)}`} onClick={() => setConfirming(s)}>Sign out</button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="settings-section" aria-labelledby="password-head">
        <h2 id="password-head" className="section-head">Password</h2>
        <form onSubmit={(e) => void changePassword(e)} noValidate>
          <div className="field">
            <label htmlFor="current-password">Current password</label>
            <input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)}
              aria-describedby={errors.current_password ? 'current-password-error' : undefined} />
            {errors.current_password && <p id="current-password-error" className="field-error">{errors.current_password}</p>}
          </div>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)}
              aria-describedby={errors.new_password ? 'new-password-error' : undefined} />
            {errors.new_password && <p id="new-password-error" className="field-error">{errors.new_password}</p>}
          </div>
          <button type="submit" className="primary">Change password</button>
        </form>
      </section>

      <section className="settings-section">
        <button type="button" onClick={() => void signOut()}>Sign out</button>
      </section>

      {confirming && (
        <Dialog label="Sign out this device?" role="alertdialog" onClose={() => setConfirming(null)} describedBy="signout-copy"
          returnFocus={() => document.querySelector<HTMLElement>(`[data-session-id="${confirming.id}"]`)}>
          <h2>Sign out this device?</h2>
          <p id="signout-copy">{label(confirming)}</p>
          <div className="dialog-actions">
            <button type="button" onClick={() => setConfirming(null)}>Cancel</button>
            <button type="button" className="primary" onClick={() => void signOutDevice()}>Sign out device</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
