/**
 * Member shapes shared by the API and the rendered pages.
 */

import { ratingDisplay } from './ratings.js';

export const HOUSE_USERNAME = 'The house';
export const AVATAR_KEYS = Array.from({ length: 12 }, (_, i) => `avatar_${String(i + 1).padStart(2, '0')}`);
export const VIEWS = ['flat', 'deep', 'squares'];
export const PIECE_SETS_2D = ['Classic', 'Staunton Flat', 'Neo', 'Pixel'];
export const PIECE_SETS_3D = ['Marble', 'Wood', 'Glass'];
export const THEMES = ['Walnut', 'Slate', 'Ocean', 'Forest', 'Neon'];

export function avatarUrl(member) {
  if (!member) return '/media/avatars/house.png';
  if (member.avatar_key === 'upload') return `/media/members/${member.id}.png`;
  const key = AVATAR_KEYS.includes(member.avatar_key) ? member.avatar_key : 'avatar_01';
  return `/media/avatars/${key}.png`;
}

export function publicMember(member) {
  if (!member) return null;
  return {
    id: member.id,
    username: member.username,
    rating: member.rating,
    rated_games: member.rated_games,
    rating_display: ratingDisplay(member.rating, member.rated_games),
    avatar_url: avatarUrl(member),
    role: member.role,
  };
}

export function selfMember(member) {
  return {
    ...publicMember(member),
    email: member.email,
    view: member.view,
    piece_set_2d: member.piece_set_2d,
    piece_set_3d: member.piece_set_3d,
    theme: member.theme,
    sound: member.sound,
    created_at: member.created_at,
  };
}

/** The side of a game that the house plays. */
export function housePlayer() {
  return {
    id: null,
    username: HOUSE_USERNAME,
    rating: null,
    rating_display: null,
    rated_games: null,
    avatar_url: '/media/avatars/house.png',
    role: null,
  };
}

export function isValidUsername(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(name);
}
