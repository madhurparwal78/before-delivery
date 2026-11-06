import { randomBytes, randomInt } from 'node:crypto';

const LOWER_ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A run of lowercase letters and digits, drawn without bias. */
function lowerAlnum(length: number): string {
  const bytes = randomBytes(length * 2);
  let out = '';
  let index = 0;
  while (out.length < length) {
    const byte = bytes[index % bytes.length]!;
    index += 1;
    if (byte < 252) out += LOWER_ALNUM[byte % 36];
  }
  return out;
}

function urlSafe(byteLength: number): string {
  return randomBytes(byteLength).toString('base64url');
}

export const newCourierId = (): string => `cr_${lowerAlnum(20)}`;
export const newAcceptanceId = (): string => `acc_${lowerAlnum(20)}`;
export const newMovementId = (): string => `mv_${lowerAlnum(20)}`;
export const newDeliveryId = (): string => `dl_${lowerAlnum(20)}`;
export const newRouteId = (): string => `rt_${lowerAlnum(20)}`;
export const newRushId = (): string => `rp_${lowerAlnum(20)}`;
export const newPostcardId = (): string => `pc_${lowerAlnum(20)}`;
export const newModerationRef = (): string => `mod_${lowerAlnum(24)}`;
export const newSessionId = (): string => urlSafe(32);
export const newPostboxKeyToken = (): string => urlSafe(32);
export const newShareToken = (): string => urlSafe(24);

/** The `Courier <four random digits>` name a guest or a renamed courier is given. */
export function generatedCourierName(): string {
  return `Courier ${String(randomInt(0, 10000)).padStart(4, '0')}`;
}
