import { Router } from 'express';
import { AppError } from '../../errors.js';
import { copy } from '../../../shared/copy.js';
import { body } from '../boundary.js';
import { endSession, requireUser, startSession } from '../auth.js';
import { FieldErrors, readText } from '../validate.js';
import {
  DEFAULT_PREFERENCES,
  authenticate,
  createUser,
  readPreferences,
  writePreferences,
} from '../../services/pocketbase.js';

export const platformRouter = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

platformRouter.post('/auth/register', async (request, response) => {
  const input = body(request);
  const errors = new FieldErrors();
  const name = readText(input.name)?.trim() ?? '';
  const email = readText(input.email)?.trim() ?? '';
  const password = readText(input.password) ?? '';
  if (name.length === 0) errors.add('name', copy.nameRequired);
  if (!EMAIL_PATTERN.test(email)) errors.add('email', copy.emailInvalid);
  if (password.length < 10 || password.length > 72) errors.add('password', copy.passwordLength);
  errors.throwIfAny();
  const user = await createUser({ name, email, password, role: 'visitor' });
  await startSession(response, user);
  response.status(201).json({ user });
});

platformRouter.post('/auth/login', async (request, response) => {
  const input = body(request);
  const email = readText(input.email)?.trim() ?? '';
  const password = readText(input.password) ?? '';
  const user = await authenticate(email, password);
  if (!user) throw new AppError('invalid_credentials');
  await startSession(response, user);
  response.json({ user });
});

platformRouter.post('/auth/logout', async (request, response) => {
  await endSession(request, response);
  response.status(204).end();
});

platformRouter.get('/me', async (request, response) => {
  const user = requireUser(request);
  let preferences = { ...DEFAULT_PREFERENCES };
  try {
    preferences = await readPreferences(user.id);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'accounts_unavailable') throw error;
  }
  response.json({ user, preferences });
});

platformRouter.put('/me/preferences', async (request, response) => {
  const user = requireUser(request);
  const input = body(request);
  const errors = new FieldErrors();
  if (typeof input.motion !== 'boolean') errors.add('motion', 'Choose on or off.');
  if (typeof input.sound !== 'boolean') errors.add('sound', 'Choose on or off.');
  errors.throwIfAny();
  const preferences = await writePreferences(user.id, {
    motion: input.motion as boolean,
    sound: input.sound as boolean,
  });
  response.json({ preferences });
});
