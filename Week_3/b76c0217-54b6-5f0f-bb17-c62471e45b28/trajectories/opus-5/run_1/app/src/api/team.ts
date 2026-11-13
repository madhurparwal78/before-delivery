import { config } from '../config';
import {
  createInvite,
  createSession,
  createUser,
  findUserByEmail,
  inviteById,
  inviteByToken,
  listInvites,
  markInviteAccepted,
  markInviteSent,
  pendingInvite,
  setMemberRole,
  teamById,
  teamMembers,
  userById,
  type Invite,
  type InviteStatus,
} from '../db/accounts';
import { db } from '../db/pool';
import { messages } from '../domain/messages';
import { apiError, validationFailed } from '../http/errors';
import { readJsonBody, sendJson, setCookie, str, type Ctx } from '../http/http';
import { emitInvite, emitRole } from '../services/events';
import { MailUnavailable, sendMail } from '../services/mail';
import { hashPassword } from '../services/passwords';
import { requireOwner, requireUser, SESSION_COOKIE } from './auth';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const statusOf = (invite: Invite): InviteStatus =>
  invite.status === 'accepted'
    ? 'accepted'
    : invite.expiresAt.getTime() <= Date.now()
      ? 'expired'
      : invite.status;

const inviteBody = (invite: Invite): Record<string, unknown> => ({
  id: invite.id,
  email: invite.email,
  role: invite.role,
  status: statusOf(invite),
  createdAt: invite.createdAt.toISOString(),
  sentAt: invite.sentAt === null ? null : invite.sentAt.toISOString(),
});

export async function getTeam(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const team = await teamById(user.teamId);
  if (team === null) throw apiError('not_found');
  const [members, invites] = await Promise.all([teamMembers(team.id), listInvites(team.id)]);
  sendJson(ctx, 200, {
    id: team.id,
    name: team.name,
    members: members.map((member) => ({
      userId: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
    })),
    invites: invites.map(inviteBody),
  });
}

async function mailInvite(invite: Invite, inviterName: string, teamName: string): Promise<void> {
  await sendMail({
    to: invite.email,
    subject: messages.inviteSubject(inviterName, teamName),
    text: `${inviterName} invited you to join ${teamName} on Galley.\n\nOpen this link to join:\n${config.appPublicUrl}/invite/${invite.token}\n`,
  });
}

export async function createTeamInvite(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const user = await requireUser(ctx);
  requireOwner(user);
  const email = (str(body, 'email') ?? '').trim().toLowerCase();
  const role = str(body, 'role');
  if (!EMAIL.test(email)) throw validationFailed({ email: 'Enter an email address.' });
  if (role !== 'editor' && role !== 'viewer') {
    throw validationFailed({ role: 'Choose Editor or Viewer.' });
  }
  if ((await findUserByEmail(email)) !== null) throw apiError('email_in_use');
  if ((await pendingInvite(user.teamId, email)) !== null) throw apiError('invite_pending');
  const team = await teamById(user.teamId);
  if (team === null) throw apiError('not_found');
  const invite = await createInvite({
    teamId: user.teamId,
    invitedBy: user.id,
    email,
    role,
    status: 'held',
    ttlMs: config.inviteTtlMs,
  });
  try {
    await mailInvite(invite, user.name, team.name);
  } catch (error) {
    if (!(error instanceof MailUnavailable)) throw error;
    emitInvite(user.teamId, inviteBody(invite));
    sendJson(ctx, 202, inviteBody(invite));
    return;
  }
  const sent = await markInviteSent(invite.id);
  emitInvite(user.teamId, inviteBody(sent));
  sendJson(ctx, 201, inviteBody(sent));
}

export async function sendInviteNow(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  requireOwner(user);
  const invite = await inviteById(ctx.params.inviteId);
  if (invite === null || invite.teamId !== user.teamId) throw apiError('not_found');
  const team = await teamById(user.teamId);
  const inviter = await userById(invite.invitedBy);
  if (team === null || inviter === null) throw apiError('not_found');
  try {
    await mailInvite(invite, inviter.name, team.name);
  } catch (error) {
    if (!(error instanceof MailUnavailable)) throw error;
    throw apiError('mail_unavailable', messages.stillUnavailable);
  }
  const sent = await markInviteSent(invite.id);
  emitInvite(user.teamId, inviteBody(sent));
  sendJson(ctx, 200, inviteBody(sent));
}

export async function updateMember(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const user = await requireUser(ctx);
  requireOwner(user);
  const member = await userById(ctx.params.userId);
  if (member === null || member.teamId !== user.teamId) throw apiError('not_found');
  const role = str(body, 'role');
  if (member.role === 'owner') throw apiError('owner_role_fixed');
  if (role !== 'editor' && role !== 'viewer') {
    throw validationFailed({ role: 'Choose Editor or Viewer.' });
  }
  await setMemberRole(member.id, role);
  emitRole(user.teamId, { userId: member.id, role });
  sendJson(ctx, 200, { userId: member.id, name: member.name, email: member.email, role });
}

/** Accepting creates the user with the invited role and signs them in. */
export async function acceptInvite(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const invite = await inviteByToken(ctx.params.token);
  if (invite === null || statusOf(invite) !== 'held' && statusOf(invite) !== 'sent') {
    throw apiError('invite_invalid');
  }
  const name = (str(body, 'name') ?? '').trim();
  const password = str(body, 'password') ?? '';
  const fields: Record<string, string> = {};
  if (name === '') fields.name = 'Enter your name.';
  if (password.length < 10 || password.length > 200) {
    fields.password = 'Passwords are 10 to 200 characters.';
  }
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  if ((await findUserByEmail(invite.email)) !== null) throw apiError('email_in_use');
  const user = await createUser(db, {
    teamId: invite.teamId,
    email: invite.email,
    name,
    passwordHash: await hashPassword(password),
    role: invite.role,
  });
  await markInviteAccepted(db, invite.id);
  const sessionId = await createSession(user.id);
  setCookie(ctx, SESSION_COOKIE, sessionId, { maxAgeSeconds: 60 * 60 * 24 * 14 });
  emitInvite(invite.teamId, inviteBody({ ...invite, status: 'accepted' }));
  sendJson(ctx, 201, { user: { id: user.id, email: user.email, name: user.name } });
}

export { statusOf as inviteStatusOf, inviteBody };
