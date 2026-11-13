import { api } from "../api";
import { hundredths, tenths } from "../format";
import { Link, navigate } from "../router";
import { useStore } from "../store";
import { GameFeed } from "./GameFeed";
import { ImportTrigger } from "./ImportSheet";

function Meter({ label, now, max, text, tone }: { label: string; now: number; max: number; text: string; tone: string }) {
  return (
    <div className={`meter meter-${tone}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={now} aria-valuetext={text}>
      <span className="meter-fill" style={{ width: `${Math.max(0, Math.min(100, (now / max) * 100))}%` }} />
    </div>
  );
}

async function signOut(): Promise<void> {
  await api("POST", "/api/auth/logout", {});
  navigate("/signin");
}

export function PlayerBar() {
  const me = useStore((state) => state.me);
  return (
    <header className="player-bar">
      <Link href="/board" className="brand">Deedfall</Link>
      {me && (
        <>
          <div className="player-id">
            <span className="player-name">{me.username}</span>
            <span className="player-level">{`Level ${me.level}`}</span>
          </div>
          <div className="player-meters">
            <div className="meter-row">
              <span className="meter-label" aria-hidden="true">Health</span>
              <Meter label="Health" now={me.health} max={me.maxHealth} text={`${tenths(me.health)} / ${tenths(me.maxHealth)}`} tone="health" />
              <span className="meter-text" aria-hidden="true">{`${tenths(me.health)} / ${tenths(me.maxHealth)}`}</span>
            </div>
            <div className="meter-row">
              <span className="meter-label" aria-hidden="true">Experience</span>
              <Meter label="Experience" now={me.experience} max={me.experienceToLevel} text={`${me.experience} / ${me.experienceToLevel}`} tone="experience" />
              <span className="meter-text" aria-hidden="true">{`${me.experience} / ${me.experienceToLevel}`}</span>
            </div>
          </div>
          <div className="player-gold" role="status" aria-label="Gold">{`${hundredths(me.gold)} gold`}</div>
          <nav className="player-nav" aria-label="Account">
            <Link href="/settings" className="nav-link">Settings</Link>
            <Link href="/imports" className="nav-link">Import history</Link>
            <Link href="/history" className="nav-link">Quest history</Link>
            <ImportTrigger />
            <button type="button" className="btn" onClick={() => void signOut()}>Sign out</button>
          </nav>
        </>
      )}
      <GameFeed />
    </header>
  );
}
