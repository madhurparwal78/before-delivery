// Sign in and sign up: the form beside the one-line statement and the four-band lifecycle drawing.
import { useState } from "react";
import { api, ApiFailure } from "../lib/api";
import { connectLive } from "../lib/live";
import { Link, navigate } from "../lib/router";
import { update, type Me } from "../lib/store";
import { ErrorSummary, Field, useBusy } from "../lib/ui";

/** Four bands of unequal width on one ruled baseline: generations step from hot to archive, and delete is outlined. */
const BANDS: Array<{ name: string; x: number; width: number; cells: number }> = [
  { name: "hot", x: 12, width: 104, cells: 2 },
  { name: "warm", x: 124, width: 124, cells: 3 },
  { name: "archive", x: 256, width: 160, cells: 4 },
  { name: "delete", x: 424, width: 84, cells: 0 },
];

function LifecycleDrawing() {
  return (
    <svg role="img" aria-label="Lifecycle: hot, warm, archive, delete" viewBox="0 0 520 216" xmlns="http://www.w3.org/2000/svg">
      <title>Lifecycle: hot, warm, archive, delete</title>
      <desc>A drafted record of the four phases of a data stream, hot, warm, archive and delete, along one time baseline.</desc>
      <defs>
        <pattern id="hatch-warm" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#7a5200" strokeWidth="1" /></pattern>
        <pattern id="hatch-archive" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#35597c" strokeWidth="1" /></pattern>
      </defs>
      <line x1="12" x2="508" y1="34" y2="34" stroke="#55645a" strokeWidth="1" />
      <path d="M12 34 l6 -4 v8 z M508 34 l-6 -4 v8 z" fill="#55645a" />
      <text x="260" y="26" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="19" fill="#55645a">time since rollover</text>
      {BANDS.map((band, k) => {
        const fill = band.name === "hot" ? "#efe8d6" : band.name === "warm" ? "url(#hatch-warm)" : band.name === "archive" ? "url(#hatch-archive)" : "none";
        return (
          <g key={band.name}>
            <line x1={band.x + band.width / 2} x2={band.x + band.width / 2} y1="68" y2="78" stroke="#1b2a22" strokeWidth="1" />
            <text x={band.x + band.width / 2} y="62" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="20" fontWeight="500" fill="#1b2a22">{band.name}</text>
            <rect x={band.x} y="80" width={band.width} height="84" fill="#f7f3ea" />
            <rect x={band.x} y="80" width={band.width} height="84" fill={fill} fillOpacity="0.55" stroke="#1b2a22" strokeWidth="1.5" strokeDasharray={band.name === "delete" ? "5 4" : undefined} />
            {Array.from({ length: band.cells }, (_, cell) => (
              <rect key={cell} x={band.x + 10 + cell * 36} y="102" width="26" height="40" fill="#f7f3ea" stroke="#1b2a22" strokeWidth="1" />
            ))}
            {band.name === "delete" ? <path d={`M${band.x + 14} 152 L${band.x + band.width - 14} 92 M${band.x + 14} 92 L${band.x + band.width - 14} 152`} stroke="#a3301e" strokeWidth="1.5" /> : null}
            {k > 0 ? <path d={`M${band.x - 8} 122 h6 l-3 -3 m3 3 l-3 3`} stroke="#1b2a22" strokeWidth="1" fill="none" /> : null}
          </g>
        );
      })}
      <line x1="12" x2="508" y1="164" y2="164" stroke="#1b2a22" strokeWidth="1.5" />
      {Array.from({ length: 63 }, (_, tick) => (
        <line key={tick} x1={12 + tick * 8} x2={12 + tick * 8} y1="164" y2={tick % 8 === 0 ? 176 : 170} stroke="#1b2a22" strokeWidth="1" />
      ))}
      <text x="12" y="204" fontFamily="JetBrains Mono, monospace" fontSize="19" fill="#55645a">rollover</text>
      <text x="508" y="204" textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="19" fill="#55645a">storage</text>
    </svg>
  );
}

export function Auth({ mode }: { mode: "signin" | "signup" }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const signUp = mode === "signup";
  const submit = (): Promise<void> =>
    run(async () => {
      try {
        await api.post(signUp ? "/api/signup" : "/api/signin", { username, password });
        const me = await api.get<Me>("/api/me");
        update({ me, seq: me.seq, loaded: true });
        connectLive(me.space.slug, me.seq);
        navigate("/explore", true);
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  return (
    <main className="auth" data-seq="0" data-pending="0">
      <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
        <p className="wordmark">Spoorline</p>
        <h1>{signUp ? "Create an account" : "Sign in"}</h1>
        <ErrorSummary failure={failure} labels={{ username: "Username", password: "Password" }} />
        <Field label="Username" error={failure?.fields.username}>
          {(props) => <input {...props} type="text" name="username" data-field="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} />}
        </Field>
        <Field label="Password" error={failure?.fields.password}>
          {(props) => <input {...props} type="password" name="password" data-field="password" autoComplete={signUp ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} />}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>{signUp ? "Create account" : "Sign in"}</button>
          {signUp ? <Link to="/signin" className="btn btn-outline">Sign in instead</Link> : <Link to="/signup" className="btn btn-outline">Create an account</Link>}
        </div>
      </form>
      <aside className="auth-side">
        <p>Search, alert and trace your logs with every rule published.</p>
        <LifecycleDrawing />
      </aside>
    </main>
  );
}

