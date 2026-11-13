import type { MatchState, Role, TournamentState } from './api.js';

// Small facts about roles and states, decided once for the server and the client.
export const isOrganizerRole = (role: Role): boolean => role === 'organizer' || role === 'co_organizer';
export const isStarted = (state: TournamentState): boolean => state === 'running' || state === 'finished';
export const isDecided = (state: MatchState): boolean => state === 'confirmed' || state === 'resolved';
