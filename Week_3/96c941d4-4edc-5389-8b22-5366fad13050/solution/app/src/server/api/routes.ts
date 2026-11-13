import { route } from '../http.js';
import type { Route } from '../http.js';
import {
  createAccount,
  readCampaign,
  readProgress,
  readRules,
  readSession,
  signIn,
  signOut,
} from './identity.js';
import {
  checkCommand,
  issueTicket,
  readFrames,
  readRun,
  retryVerification,
  startRun,
  submitEvidence,
} from './runs.js';
import {
  createLevel,
  listLevels,
  publishLevel,
  readLevel,
  saveLevel,
  withdrawLevel,
} from './maker.js';
import { readChallenge, readLeaderboard, searchChallenges } from './community.js';
import { readReplay, readSnapshot, updatePlayback } from './results.js';
import { readSeason } from './seasonRoutes.js';

export const ROUTES: Route[] = [
  route('POST', '/api/accounts', createAccount),
  route('POST', '/api/session', signIn),
  route('GET', '/api/session', readSession, { authenticated: true }),
  route('DELETE', '/api/session', signOut, { authenticated: true }),
  route('GET', '/api/rules', readRules),
  route('GET', '/api/campaign', readCampaign, { authenticated: true }),
  route('GET', '/api/progress', readProgress, { authenticated: true }),
  route('POST', '/api/runs', issueTicket, { authenticated: true }),
  route('POST', '/api/runs/:id/start', startRun, { authenticated: true }),
  route('POST', '/api/runs/:id/commands/check', checkCommand, {
    authenticated: true,
    commandBody: true,
  }),
  route('POST', '/api/runs/:id/submit', submitEvidence, { authenticated: true, commandBody: true }),
  route('POST', '/api/runs/:id/retry', retryVerification, { authenticated: true }),
  route('GET', '/api/runs/:id', readRun, { authenticated: true }),
  route('GET', '/api/runs/:id/frames', readFrames),
  route('POST', '/api/levels', createLevel, { authenticated: true }),
  route('GET', '/api/levels', listLevels, { authenticated: true }),
  route('GET', '/api/levels/:id', readLevel, { authenticated: true }),
  route('PUT', '/api/levels/:id', saveLevel, { authenticated: true }),
  route('POST', '/api/levels/:id/publish', publishLevel, { authenticated: true }),
  route('POST', '/api/levels/:id/withdraw', withdrawLevel, { authenticated: true }),
  route('GET', '/api/challenges', searchChallenges),
  route('GET', '/api/challenges/:digest', readChallenge),
  route('GET', '/api/challenges/:digest/leaderboard', readLeaderboard),
  route('GET', '/api/results/:id/replay', readReplay),
  route('GET', '/api/results/:id/snapshot', readSnapshot),
  route('PUT', '/api/results/:id/playback', updatePlayback, { authenticated: true }),
  route('GET', '/api/season', readSeason),
];
