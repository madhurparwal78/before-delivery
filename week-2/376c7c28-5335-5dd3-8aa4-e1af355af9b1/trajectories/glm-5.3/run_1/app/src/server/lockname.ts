// Stable advisory-lock names, all in one place.
export const lockName = {
  member: (memberId: string): string => `kd-member-${memberId}`,
  load: (loadId: string): string => `kd-load-${loadId}`,
  kiln: (kilnId: string): string => `kd-kiln-${kilnId}`,
  piece: (pieceId: string): string => `kd-piece-${pieceId}`,
  signin: (slug: string, email: string): string => `kd-signin-${slug}-${email}`,
  invite: (studioId: string, email: string): string => `kd-invite-${studioId}-${email}`,
  packDay: (memberId: string, day: string): string => `kd-packday-${memberId}-${day}`,
  idem: (studioId: string, endpoint: string, key: string): string => `kd-idem-${studioId}-${endpoint}-${key}`,
  close: (studioId: string, month: string): string => `kd-close-${studioId}-${month}`,
  schedule: (studioId: string, date: string): string => `kd-schedule-${studioId}-${date}`,
  charge: (chargeId: string): string => `kd-charge-${chargeId}`,
  photo: (pieceId: string): string => `kd-photo-${pieceId}`,
  storage: (pieceId: string, day: string): string => `kd-storage-${pieceId}-${day}`,
};
