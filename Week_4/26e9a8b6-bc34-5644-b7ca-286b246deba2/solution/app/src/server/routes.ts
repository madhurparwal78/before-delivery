import { confirmAccount, currentSession, resendConfirmation, signIn, signOut, signUp } from './auth';
import { addItem, createCollection, moveItem, readCollection } from './collections';
import { config, limits } from './config';
import { dashboard } from './dashboard';
import { health } from './health';
import { createWorld } from './grading';
import type { Route } from './http';
import { createGuide, deleteGuide, forkGuide, likeGuide, publishGuide, readGuide, readStill, unlikeGuide, withdrawGuide } from './lifecycle';
import { serveModel, uploadModel } from './models';
import { answerQuestion, askQuestion, listQuestions } from './questions';
import { search, tags } from './search';
import { compare, listVersions, readVersion, restoreVersion, saveVersion } from './versions';
import { addCoauthor, addStep, commitField, deletePart, deleteStep, moveStep, readWorking, removeCoauthor } from './working';

export const routes: Route[] = [
  { method: 'GET', path: '/api/health', handler: health },
  { method: 'GET', path: '/api/limits', handler: async () => limits },
  { method: 'GET', path: '/api/search', handler: search },
  { method: 'GET', path: '/api/tags', handler: tags },
  { method: 'POST', path: '/api/accounts', body: 'json', status: 201, handler: signUp },
  { method: 'POST', path: '/api/session', body: 'json', handler: signIn },
  { method: 'GET', path: '/api/session', handler: currentSession },
  { method: 'DELETE', path: '/api/session', handler: signOut },
  { method: 'POST', path: '/api/account/resend', body: 'json', handler: resendConfirmation },
  { method: 'POST', path: '/api/account/confirm', body: 'json', handler: confirmAccount },
  { method: 'GET', path: '/api/dashboard', handler: dashboard },
  { method: 'POST', path: '/api/guides', body: 'json', status: 201, handler: createGuide },
  { method: 'GET', path: '/api/guides/:id', handler: readGuide },
  { method: 'DELETE', path: '/api/guides/:id', handler: deleteGuide },
  { method: 'GET', path: '/api/guides/:id/working', handler: readWorking },
  { method: 'PATCH', path: '/api/guides/:id/working', body: 'json', handler: commitField },
  { method: 'POST', path: '/api/guides/:id/steps', body: 'json', status: 201, handler: addStep },
  { method: 'DELETE', path: '/api/guides/:id/steps/:stepId', handler: deleteStep },
  { method: 'POST', path: '/api/guides/:id/steps/:stepId/move', body: 'json', handler: moveStep },
  { method: 'DELETE', path: '/api/guides/:id/parts/:partId', handler: deletePart },
  { method: 'POST', path: '/api/guides/:id/coauthors', body: 'json', status: 201, handler: addCoauthor },
  { method: 'DELETE', path: '/api/guides/:id/coauthors/:userId', handler: removeCoauthor },
  { method: 'POST', path: '/api/guides/:id/publish', body: 'json', handler: publishGuide },
  { method: 'POST', path: '/api/guides/:id/withdraw', body: 'json', handler: withdrawGuide },
  { method: 'PUT', path: '/api/guides/:id/like', body: 'json', handler: likeGuide },
  { method: 'DELETE', path: '/api/guides/:id/like', handler: unlikeGuide },
  { method: 'POST', path: '/api/guides/:id/model', body: 'binary', status: 201, handler: uploadModel },
  { method: 'GET', path: '/api/models/:file', handler: serveModel },
  { method: 'GET', path: '/api/guides/:id/stills/:n', handler: readStill },
  { method: 'POST', path: '/api/guides/:id/versions', body: 'json', status: 201, handler: saveVersion },
  { method: 'GET', path: '/api/guides/:id/versions', handler: listVersions },
  { method: 'GET', path: '/api/guides/:id/versions/compare', handler: compare },
  { method: 'GET', path: '/api/guides/:id/versions/:n', handler: readVersion },
  { method: 'POST', path: '/api/guides/:id/versions/:n/restore', body: 'json', status: 201, handler: restoreVersion },
  { method: 'POST', path: '/api/guides/:id/forks', body: 'json', status: 201, handler: forkGuide },
  { method: 'POST', path: '/api/collections', body: 'json', status: 201, handler: createCollection },
  { method: 'GET', path: '/api/collections/:id', handler: readCollection },
  { method: 'POST', path: '/api/collections/:id/items', body: 'json', status: 201, handler: addItem },
  { method: 'POST', path: '/api/collections/:id/items/:guideId/move', body: 'json', handler: moveItem },
  { method: 'GET', path: '/api/guides/:id/questions', handler: listQuestions },
  { method: 'POST', path: '/api/guides/:id/questions', body: 'json', status: 201, handler: askQuestion },
  { method: 'POST', path: '/api/questions/:id/answer', body: 'json', status: 201, handler: answerQuestion },
  ...(config.gradingRoutes ? [{ method: 'POST', path: '/api/grading/world', body: 'json' as const, status: 201, handler: createWorld }] : []),
];
