import type { Player } from '../../shared/types.js';
import { gold2 } from '../../shared/format.js';
import { api } from '../api.js';
import { disconnectLive, resetSession } from '../store.js';
import { navigate } from '../router.js';
import { ExperienceMeter, HealthMeter } from './Meters.js';

export const REST_BANNER = 'Resting: missed dailies will not hurt you or your party.';

interface PlayerBarProps {
  player: Player;
  onImport: (opener: HTMLElement | null) => void;
}

export function PlayerBar({ player, onImport }: PlayerBarProps): JSX.Element {
  return (
    <>
      <header className="player-bar">
        <div className="player-identity">
          <span className="player-name">{player.username}</span>
          <span className="player-level">{`Level ${player.level}`}</span>
        </div>
        <div className="player-meters">
          <HealthMeter value={player.health} />
          <ExperienceMeter value={player.experience} max={player.experienceToLevel} />
          <div role="status" aria-label="Gold" className="gold-status tabular">
            {`${gold2(player.gold)} gold`}
          </div>
        </div>
        <nav className="player-links">
          <a href="/settings" onClick={navigateTo('/settings')}>
            Settings
          </a>
          <a href="/imports" onClick={navigateTo('/imports')}>
            Import history
          </a>
          <a href="/history" onClick={navigateTo('/history')}>
            Quest history
          </a>
          <button type="button" onClick={(event) => onImport(event.currentTarget)}>
            Import tasks
          </button>
          <button
            type="button"
            onClick={() => {
              void api.logout().then(() => {
                disconnectLive();
                resetSession();
                navigate('/');
              });
            }}
          >
            Sign out
          </button>
        </nav>
      </header>
      {player.resting ? (
        <div role="status" className="rest-banner">
          {REST_BANNER}
        </div>
      ) : null}
    </>
  );
}

function navigateTo(path: string) {
  return (event: React.MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    navigate(path);
  };
}
