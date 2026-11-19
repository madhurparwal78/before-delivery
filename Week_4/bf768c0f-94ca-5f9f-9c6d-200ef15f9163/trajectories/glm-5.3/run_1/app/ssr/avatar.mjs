// Avatar URL derivation shared by the pages.
export function avatarUrlOf(member) {
  if (!member) return '/media/avatars/avatar_01.svg';
  if (member.avatar_key && member.avatar_key.startsWith('uploaded:')) {
    return `/media/avatars/${member.id}.png`;
  }
  if (member.avatar_key === 'avatar_house') return '/media/avatars/house.svg';
  return `/media/avatars/${member.avatar_key || 'avatar_01'}.svg`;
}
