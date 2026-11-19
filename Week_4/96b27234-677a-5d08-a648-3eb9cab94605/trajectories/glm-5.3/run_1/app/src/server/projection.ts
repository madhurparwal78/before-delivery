// Per-viewer projection. A blocked person's real name never appears, chat text
// reaches only recipients, and avatar states follow the published precedence.
import { query } from './db';
import type { PersonState } from './live';
import { areFriends, isBlockedBetween, hasMute } from './live';

export type AvatarView = 'shown' | 'hidden' | 'fallback';

const RANK_ORDER: Record<string, number> = { Feather: 0, Linen: 1, Cedar: 2, Granite: 3 };

// The single place a viewer's view of another person's avatar state is decided.
// Precedence: fallback, then hidden, then shown.
export function avatarStateFor(viewer: {
  isSelf: boolean;
  blockedBetween: boolean;
  targetHasAvatar: boolean;
  targetAvatarRank: string | null;
  hideAbove: string | null;
}): AvatarView {
  if (viewer.isSelf) return viewer.targetHasAvatar ? 'shown' : 'fallback';
  if (viewer.blockedBetween) return 'fallback';
  if (!viewer.targetHasAvatar) return 'fallback';
  if (viewer.hideAbove && viewer.targetAvatarRank && RANK_ORDER[viewer.targetAvatarRank] > RANK_ORDER[viewer.hideAbove]) {
    return 'hidden';
  }
  return 'shown';
}

export interface PersonProjection {
  personId: string;
  displayName: string;
  x: number;
  y: number;
  facing: string;
  seated: boolean;
  avatar: AvatarView;
  host: boolean;
}

export async function projectPeople(
  sessionId: string,
  hostId: string,
  states: Map<string, PersonState>,
  viewerId: string,
  hideAbove: string | null
): Promise<PersonProjection[]> {
  const ids = [...states.keys()];
  const people = await query<{ id: string; display_name: string; avatar_id: string | null }>(
    'SELECT id, display_name, avatar_id FROM people WHERE id = ANY($1)',
    [ids]
  );
  const byId = new Map(people.map((p) => [p.id, p]));
  const avatarRanks = new Map<string, string>();
  const avatarIds = people.map((p) => p.avatar_id).filter((x): x is string => !!x);
  if (avatarIds.length) {
    const rows = await query<{ id: string; rank: string }>(
      `SELECT a.id, v.rank FROM assets a JOIN versions v ON v.asset_id = a.id AND v.version = a.current_version
       WHERE a.id = ANY($1)`,
      [avatarIds]
    );
    rows.forEach((r) => avatarRanks.set(r.id, r.rank));
  }
  const out: PersonProjection[] = [];
  for (const [pid, st] of states) {
    const person = byId.get(pid);
    const avatarId = person?.avatar_id ?? st.avatarId ?? null;
    const blocked = pid === viewerId ? false : await isBlockedBetween(viewerId, pid);
    const state = avatarStateFor({
      isSelf: pid === viewerId,
      blockedBetween: blocked,
      targetHasAvatar: !!avatarId,
      targetAvatarRank: avatarId ? avatarRanks.get(avatarId) ?? 'Feather' : null,
      hideAbove,
    });
    out.push({
      personId: pid,
      displayName: pid === viewerId || !blocked ? person?.display_name ?? st.name : 'Someone',
      x: st.x,
      y: st.y,
      facing: st.facing,
      seated: st.seated,
      avatar: state,
      host: pid === hostId,
    });
  }
  return out.sort((a, b) => (a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0));
}

export async function projectedName(viewerId: string, targetId: string, realName: string): Promise<string> {
  if (viewerId === targetId) return realName;
  if (await isBlockedBetween(viewerId, targetId)) return 'Someone';
  return realName;
}

export async function viewerSeesFriendPresence(viewerId: string, targetId: string): Promise<boolean> {
  if (await isBlockedBetween(viewerId, targetId)) return false;
  return areFriends(viewerId, targetId);
}

export { areFriends, hasMute };
