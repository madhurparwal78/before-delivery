import { useCallback, useEffect, useRef, useState } from "react";
import type { Table } from "../shared/api-types";
import { newsOf } from "./copy";
import { MS, ease, prefersReducedMotion } from "./motion";

interface TileView {
  teamId: number;
  name: string;
  position: number;
  total: number;
  lastRound: { round: number; score: number } | null;
  /** Half-turn angle of the article, 0 when it is not turning. */
  angle: number;
  /** The revealed face is drawn counter-rotated so it reads upright. */
  mirrored: boolean;
  /** Remaining distance to the tile's new place while it slides. */
  slide: { x: number; y: number } | null;
}

interface Run {
  from: Table;
  to: Table;
  startedAt: number;
  t: number;
  /** Per team: old grid place minus new grid place, measured when the slide starts. */
  offsets: Map<number, { x: number; y: number }> | null;
}

const flipEnd = (count: number) => (count - 1) * MS.stagger + MS.flip;
const runEnd = (count: number) => flipEnd(count) + MS.slide;

function steady(table: Table, names: Map<number, string>): TileView[] {
  return table.teams.map((team) => ({
    teamId: team.team_id,
    name: names.get(team.team_id) ?? team.name,
    position: team.position,
    total: team.total,
    lastRound: team.last_round,
    angle: 0,
    mirrored: false,
    slide: null,
  }));
}

function inMotion(run: Run, names: Map<number, string>): TileView[] {
  const { from, to, t, offsets } = run;
  const count = from.teams.length;
  const newest = new Map(to.teams.map((team) => [team.team_id, team]));
  if (t >= flipEnd(count)) {
    const progress = ease((t - flipEnd(count)) / MS.slide);
    const oldTotals = new Map(from.teams.map((team) => [team.team_id, team.total]));
    return to.teams.map((team) => {
      const origin = offsets?.get(team.team_id);
      const before = oldTotals.get(team.team_id) ?? team.total;
      return {
        teamId: team.team_id,
        name: names.get(team.team_id) ?? team.name,
        position: team.position,
        total: Math.round(before + (team.total - before) * progress),
        lastRound: team.last_round,
        angle: 0,
        mirrored: false,
        slide: origin === undefined ? null : { x: origin.x * (1 - progress), y: origin.y * (1 - progress) },
      };
    });
  }
  return from.teams.map((team, index) => {
    const local = t - index * MS.stagger;
    const next = newest.get(team.team_id) ?? team;
    const turned = local >= MS.flip;
    const angle = local <= 0 || turned ? 0 : ease(local / MS.flip) * 180;
    const revealed = turned || angle >= 90;
    return {
      teamId: team.team_id,
      name: names.get(team.team_id) ?? team.name,
      position: revealed ? next.position : team.position,
      total: team.total,
      lastRound: revealed ? next.last_round : team.last_round,
      angle,
      mirrored: angle >= 90,
      slide: null,
    };
  });
}

interface Cascade {
  tiles: TileView[] | null;
  news: string;
  /** Bumps when a reduced-motion table change should crossfade. */
  fadeKey: number;
  cell: (teamId: number) => (element: HTMLElement | null) => void;
}

function headline(table: Table): string {
  const leader = table.teams[0];
  return leader === undefined || table.last_published_round === null
    ? ""
    : newsOf(table.last_published_round, leader.name, leader.total);
}

/**
 * The Tally cascade. A table with a newer version than the one on screen turns every tile in the
 * previous order, one after another, then slides the tiles to their new places while the totals
 * count up; Table news speaks only once the tiles have settled. The clock is performance.now()
 * read inside requestAnimationFrame, so the cascade is driven by time alone.
 */
export function useCascade(latest: Table | null): Cascade {
  const shown = useRef<Table | null>(null);
  const run = useRef<Run | null>(null);
  const cells = useRef(new Map<number, HTMLElement>());
  const [, repaint] = useState(0);
  const [news, setNews] = useState("");
  const [fadeKey, setFadeKey] = useState(0);
  const frame = useRef(0);

  const settle = useCallback((announce: boolean) => {
    if (run.current === null) return;
    shown.current = run.current.to;
    if (announce) setNews(headline(run.current.to));
    run.current = null;
  }, []);

  const tick = useCallback(() => {
    const current = run.current;
    if (current === null) return;
    current.t = performance.now() - current.startedAt;
    const count = current.from.teams.length;
    if (current.t >= runEnd(count)) {
      settle(true);
      repaint((n) => n + 1);
      return;
    }
    if (current.t >= flipEnd(count) && current.offsets === null) {
      const places = current.from.teams.map((team) => cells.current.get(team.team_id)?.getBoundingClientRect());
      current.offsets = new Map();
      current.to.teams.forEach((team, newIndex) => {
        const oldIndex = current.from.teams.findIndex((entry) => entry.team_id === team.team_id);
        const before = places[oldIndex];
        const after = places[newIndex];
        if (before !== undefined && after !== undefined) {
          current.offsets?.set(team.team_id, { x: before.left - after.left, y: before.top - after.top });
        }
      });
    }
    repaint((n) => n + 1);
    frame.current = requestAnimationFrame(tick);
  }, [settle]);

  useEffect(() => {
    if (latest === null) return;
    if (shown.current === null) {
      shown.current = latest;
      repaint((n) => n + 1);
      return;
    }
    const target = run.current?.to ?? shown.current;
    if (latest.version <= target.version) return;
    cancelAnimationFrame(frame.current);
    settle(false);
    const from = shown.current as Table;
    if (prefersReducedMotion()) {
      shown.current = latest;
      setNews(headline(latest));
      setFadeKey((key) => key + 1);
      repaint((n) => n + 1);
      return;
    }
    run.current = { from, to: latest, startedAt: performance.now(), t: 0, offsets: null };
    repaint((n) => n + 1);
    frame.current = requestAnimationFrame(tick);
  }, [latest, settle, tick]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const names = new Map((latest?.teams ?? []).map((team) => [team.team_id, team.name]));
  const tiles =
    run.current !== null ? inMotion(run.current, names) : shown.current === null ? null : steady(shown.current, names);

  const cell = useCallback(
    (teamId: number) => (element: HTMLElement | null) => {
      if (element === null) cells.current.delete(teamId);
      else cells.current.set(teamId, element);
    },
    [],
  );
  return { tiles, news, fadeKey, cell };
}
