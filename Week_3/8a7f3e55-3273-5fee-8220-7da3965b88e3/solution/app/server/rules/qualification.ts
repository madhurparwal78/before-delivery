import type { Setting } from "../../shared/api.js";

const CREDENTIALS_BY_SETTING: Record<Setting, readonly string[]> = {
  medical: ["NIC", "BEI"],
  educational: ["EIPA", "NIC"],
  legal: ["SC:L"],
  workplace: ["NIC", "BEI"],
};

export interface Credential {
  code: string;
  expires_on: string;
}

/** Qualified: an unexpired credential from the setting's list on the booking's agency-local start date. */
export const isQualified = (credentials: readonly Credential[], setting: Setting, startDate: string): boolean =>
  credentials.some((credential) => CREDENTIALS_BY_SETTING[setting].includes(credential.code) && credential.expires_on >= startDate);
