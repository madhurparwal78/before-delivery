import type { EntrantView, MatchView, PublicEntrantView, Role, SlotView, TournamentView } from '../shared/api.js';
import { isOpen, overallCurrentRound } from '../shared/rounds.js';
import { isOrganizerRole, isStarted } from '../shared/rules.js';
import { config } from './config.js';
import { iso } from './clock.js';
import type { Draw, Entrant, Match, Slot } from './domain/types.js';

function slotView(draw: Draw, slot: Slot): SlotView {
  if (slot.kind === 'tbd') return null;
  if (slot.kind === 'bye') return { bye: true };
  return { entrant_id: slot.entrantId, name: draw.entrantById.get(slot.entrantId)?.name ?? '' };
}

// The canonical match view carries the organizer-only keys; viewers who are not organizers get them stripped.
export function matchView(draw: Draw, m: Match): MatchView {
  return {
    id: m.id, tournament_id: m.tournamentId, label: m.label, bracket: m.bracket, round: m.round, number: m.number,
    upper: slotView(draw, m.upper), lower: slotView(draw, m.lower), state: m.state,
    upper_games: m.upperGames, lower_games: m.lowerGames, winner: m.winner,
    report: m.report && { by: m.report.by, upper_games: m.report.upper, lower_games: m.report.lower,
      reported_at: iso(m.report.reportedAt), auto_confirm_at: iso(m.report.autoConfirmAt) },
    dispute: m.dispute && { by: m.dispute.by, upper_games: m.dispute.upper, lower_games: m.dispute.lower,
      disputed_at: iso(m.dispute.disputedAt) },
    called_at: m.calledAt === null ? null : iso(m.calledAt),
    version: m.version, overdue: m.overdue, updated_by: m.updatedBy,
  };
}

export function forViewer(view: MatchView, organizer: boolean): MatchView {
  if (organizer) return view;
  const { overdue: _overdue, updated_by: _updatedBy, ...rest } = view;
  return rest;
}

export const entrantView = (e: Entrant): EntrantView => ({ id: e.id, name: e.name, seed: e.seed, username: e.username, checked_in: e.checkedIn });

export function entrantForViewer(view: EntrantView, organizer: boolean): EntrantView {
  if (organizer) return view;
  const { username: _username, ...rest } = view;
  return rest;
}

export const publicEntrant = (e: { name: string; seed: number }): PublicEntrantView => ({ name: e.name, seed: e.seed });

const logoPath = (id: string, sha: string): string => `/api/tournaments/${id}/logo?v=${sha}`;

// The canonical tournament view, as an organizer sees it.
export function tournamentView(draw: Draw, coOrganizers: string[], role: Role): TournamentView {
  const t = draw.tournament;
  const started = isStarted(t.state);
  const items = draw.matches.map((m) => ({ bracket: m.bracket, round: m.round, open: isOpen(m.state, slotView(draw, m.upper), slotView(draw, m.lower)) }));
  return {
    id: t.id, name: t.name, format: t.format, time_zone: t.timeZone, fill: t.fill, state: t.state,
    checkin_closes_at: t.checkinClosesAt === null ? null : iso(t.checkinClosesAt),
    server_time: iso(draw.now), field_size: t.fieldSize, entrant_count: draw.entrants.length,
    checked_in_count: draw.entrants.filter((e) => e.checkedIn).length,
    current_round: started ? overallCurrentRound(t.format, items) : null,
    ...(t.format === 'swiss' ? { swiss_rounds: t.swissRounds } : {}),
    logo_url: t.logoSha ? logoPath(t.id, t.logoSha) : null, roster_file_name: t.rosterName,
    seeding_version: t.seedingVersion, live_seq: t.liveSeq, my_role: role,
    share_url: `${config.publicUrl}/s/${t.shareCode}`, co_organizers: coOrganizers,
  };
}

export function tournamentForViewer(view: TournamentView, role: Role): TournamentView {
  const organizer = isOrganizerRole(role);
  if (organizer) return { ...view, my_role: role };
  const { share_url: _share, co_organizers: _co, ...rest } = view;
  return { ...rest, my_role: role };
}

// The public shape of a tournament: no organizer keys, and the logo is served from the share link.
export function publicTournament(view: TournamentView): TournamentView {
  const { share_url, co_organizers: _co, ...rest } = view;
  const code = share_url?.split('/').pop() ?? '';
  return { ...rest, my_role: 'viewer', logo_url: view.logo_url && `/api/share/${code}/logo?${view.logo_url.split('?')[1] ?? ''}` };
}
