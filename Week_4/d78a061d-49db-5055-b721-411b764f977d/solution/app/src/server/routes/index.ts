import type { Ctx, Reply } from '../http.js';
import * as auth from './auth.js';
import * as characters from './characters.js';
import * as weapons from './weapons.js';
import * as models from './models.js';
import * as stories from './stories.js';
import * as social from './social.js';
import * as chat from './chat.js';

interface Route {
  method: string;
  path: string;
  handler: (ctx: Ctx) => Promise<Reply>;
}

const routes: Route[] = [
  { method: 'GET', path: '/api/health', handler: auth.health },
  { method: 'PUT', path: '/api/locale', handler: auth.putLocale },
  { method: 'POST', path: '/api/auth/signup', handler: auth.signup },
  { method: 'POST', path: '/api/auth/signin', handler: auth.signin },
  { method: 'POST', path: '/api/auth/signout', handler: auth.signout },
  { method: 'POST', path: '/api/auth/verify', handler: auth.verifyEmail },
  { method: 'POST', path: '/api/auth/verification/resend', handler: auth.resendVerification },
  { method: 'POST', path: '/api/auth/password-reset', handler: auth.requestPasswordReset },
  { method: 'POST', path: '/api/auth/password-reset/confirm', handler: auth.confirmPasswordReset },
  { method: 'GET', path: '/api/me', handler: auth.me },
  { method: 'PATCH', path: '/api/me', handler: auth.patchMe },

  { method: 'GET', path: '/api/characters', handler: characters.listCharacters },
  { method: 'PUT', path: '/api/characters/slots/:slot', handler: characters.saveCharacterSlot },
  { method: 'POST', path: '/api/characters/:id/equip', handler: characters.equipCharacter },
  { method: 'GET', path: '/api/characters/:id', handler: characters.getCharacter },
  { method: 'DELETE', path: '/api/characters/:id', handler: characters.deleteCharacter },

  { method: 'POST', path: '/api/weapons/preview', handler: weapons.previewWeapon },
  { method: 'POST', path: '/api/weapons', handler: weapons.forgeWeapon },
  { method: 'GET', path: '/api/weapons', handler: weapons.listWeapons },
  { method: 'GET', path: '/api/weapons/:id', handler: weapons.getWeapon },
  { method: 'DELETE', path: '/api/weapons/:id', handler: weapons.deleteWeapon },

  { method: 'POST', path: '/api/models', handler: models.uploadModel },
  { method: 'GET', path: '/api/models', handler: models.listModels },
  { method: 'GET', path: '/api/models/:id/file', handler: models.getModelFile },
  { method: 'GET', path: '/api/models/:id/thumbnail', handler: models.getModelThumbnail },
  { method: 'GET', path: '/api/models/:id', handler: models.getModel },
  { method: 'DELETE', path: '/api/models/:id', handler: models.deleteModel },
  { method: 'GET', path: '/api/rulebook', handler: models.getRulebook },

  { method: 'GET', path: '/api/stories', handler: stories.listStories },
  { method: 'GET', path: '/api/stories/:storyId/progress', handler: stories.getStoryProgress },
  { method: 'POST', path: '/api/stories/:storyId/sessions', handler: stories.startStorySession },
  {
    method: 'GET',
    path: '/api/sessions/:id/members/:accountId/model',
    handler: stories.getSessionMemberModel,
  },
  { method: 'GET', path: '/api/sessions/:id', handler: stories.getSession },

  { method: 'GET', path: '/api/friends', handler: social.listFriends },
  { method: 'POST', path: '/api/friends/requests', handler: social.sendFriendRequest },
  {
    method: 'POST',
    path: '/api/friends/requests/:id/accept',
    handler: social.acceptFriendRequest,
  },
  {
    method: 'POST',
    path: '/api/friends/requests/:id/decline',
    handler: social.declineFriendRequest,
  },
  { method: 'DELETE', path: '/api/friends/:accountId', handler: social.removeFriend },

  { method: 'POST', path: '/api/parties', handler: social.postParty },
  { method: 'GET', path: '/api/parties/current', handler: social.getCurrentParty },
  { method: 'GET', path: '/api/parties/:id', handler: social.getParty },
  { method: 'PATCH', path: '/api/parties/:id', handler: social.patchParty },
  { method: 'POST', path: '/api/parties/:id/invites', handler: social.postInvite },
  { method: 'POST', path: '/api/parties/:id/leave', handler: social.postPartyLeave },
  { method: 'POST', path: '/api/parties/:id/leader', handler: social.postPartyLeader },
  { method: 'POST', path: '/api/parties/:id/ready-check', handler: social.postReadyCheck },
  {
    method: 'POST',
    path: '/api/parties/:id/ready-check/response',
    handler: social.postReadyResponse,
  },
  { method: 'POST', path: '/api/parties/:id/return', handler: social.postPartyReturn },

  { method: 'GET', path: '/api/invites', handler: social.listInvites },
  { method: 'POST', path: '/api/invites/:token/accept', handler: social.postInviteAccept },
  { method: 'POST', path: '/api/invites/:token/decline', handler: social.postInviteDecline },

  { method: 'GET', path: '/api/chat/:channel/messages', handler: chat.getChatMessages },
  { method: 'POST', path: '/api/chat/:channel/messages', handler: chat.postChatMessage },
];

interface MatchedRoute {
  route: Route;
  params: Record<string, string>;
}

export function matchRoute(method: string, pathname: string): MatchedRoute | null {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  for (const route of routes) {
    const pattern = route.path.split('/').filter((segment) => segment !== '');
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < pattern.length; i += 1) {
      const part = pattern[i];
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segments[i]);
        continue;
      }
      if (part !== segments[i]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (route.method !== method) continue;
    return { route, params };
  }
  return null;
}
