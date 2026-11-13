import { useState } from 'react';
import { api, fmt1, fmtGold, type Player } from './api.js';
import { navigate } from './app.js';

export function PlayerBar({ player, onImportTasks }: { player: Player; onImportTasks?: () => void }) {
  const [error, setError] = useState('');
  return (
    <header className="player-bar">
      <span className="username">{player.username}</span>
      <span className="level-text">Level {player.level}</span>
      <div className="meter-wrap" aria-hidden="false">
        <label className="meter-label" htmlFor="health-meter">Health</label>
        <meter
          id="health-meter"
          className="health-meter"
          aria-label="Health"
          min={0}
          max={50.0}
          value={player.health}
        >
          {fmt1(player.health)} / 50.0
        </meter>
        <span className="meter-value">{fmt1(player.health)} / 50.0</span>
      </div>
      <div className="meter-wrap">
        <label className="meter-label" htmlFor="xp-meter">Experience</label>
        <meter
          id="xp-meter"
          className="xp-meter"
          aria-label="Experience"
          min={0}
          max={player.experienceToLevel}
          value={player.experience}
        >
          {player.experience} / {player.experienceToLevel}
        </meter>
        <span className="meter-value">{player.experience} / {player.experienceToLevel}</span>
      </div>
      <p className="gold-status" role="status" aria-label="Gold">
        {fmtGold(player.gold)} gold
      </p>
      <nav className="bar-links">
        <a href="/settings" onClick={(e) => { e.preventDefault(); navigate('/settings'); }}>Settings</a>
        <a href="/imports" onClick={(e) => { e.preventDefault(); navigate('/imports'); }}>Import history</a>
        <a href="/history" onClick={(e) => { e.preventDefault(); navigate('/history'); }}>Quest history</a>
      </nav>
      <button className="btn btn-small" type="button" onClick={() => { if (onImportTasks) onImportTasks(); else navigate('/imports'); }}>Import tasks</button>
      <button
        className="btn btn-small"
        type="button"
        onClick={async () => {
          try {
            await api.logout();
          } catch {
            setError('Something went wrong. Try again.');
          }
          window.location.href = '/';
        }}
      >
        Sign out
      </button>
      {error && <div className="alert-strip" role="alert">{error}</div>}
    </header>
  );
}

export function RestBanner() {
  return (
    <p className="rest-banner" role="status">
      Resting: missed dailies will not hurt you or your party.
    </p>
  );
}
