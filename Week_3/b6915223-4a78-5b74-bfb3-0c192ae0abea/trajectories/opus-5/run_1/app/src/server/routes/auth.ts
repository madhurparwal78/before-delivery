import type { Handler } from '../http/server.ts';
import { SESSION_COOKIE } from '../config.ts';
import { meView, parseSignUp, signIn, signUp } from '../game/accounts.ts';
import { createSession, deleteSession, readCookie } from '../game/sessions.ts';
import { apiError } from '../http/errors.ts';

export const postSignUp: Handler = async (context) => {
  const { email, password, teamName } = parseSignUp(context.body);
  const manager = await signUp(email, password, teamName);
  return {
    status: 201,
    body: meView(manager),
    setSession: await createSession(manager.id),
  };
};

export const postSignIn: Handler = async (context) => {
  const email = typeof context.body.email === 'string' ? context.body.email.trim() : '';
  const password = typeof context.body.password === 'string' ? context.body.password : '';
  const manager = await signIn(email, password);
  if (manager === null) {
    throw apiError(401, 'bad_credentials', 'Email or password is wrong.');
  }
  return { status: 200, body: meView(manager), setSession: await createSession(manager.id) };
};

export const postSignOut: Handler = async (context) => {
  const token = readCookie(context.headers.cookie, SESSION_COOKIE);
  if (token !== null) await deleteSession(token);
  return { status: 204, setSession: null };
};

export const getMe: Handler = async (context) => ({
  status: 200,
  body: meView(context.manager),
});
