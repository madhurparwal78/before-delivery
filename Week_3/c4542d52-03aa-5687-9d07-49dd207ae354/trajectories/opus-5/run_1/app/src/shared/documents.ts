import type { VestingType } from "./types.js";
import { formatCount, formatMoney, formatPricePerShare, vestingLabel } from "./format.js";

function lines(parts: ReadonlyArray<string>): string {
  return `${parts.join("\n")}\n`;
}

export interface GrantAgreementInput {
  grantId: string;
  holderName: string;
  options: number;
  strike: string;
  vestingType: VestingType;
  vestingStart: string;
  signedAt: string | null;
}

/** The grant agreement text, used both for the vault object and the offer's reading copy. */
export function grantAgreementText(input: GrantAgreementInput): string {
  const parts = [
    "Tidecraft Robotics, Inc. — Stock Option Grant Agreement",
    `Grant: ${input.grantId}`,
    `Holder: ${input.holderName}`,
    `Options: ${formatCount(input.options)}`,
    `Strike price: ${formatPricePerShare(input.strike)}`,
    `Vesting: ${vestingLabel(input.vestingType)}, from ${input.vestingStart}`,
  ];
  if (input.signedAt !== null) parts.push(`Signed by: ${input.holderName}`, `Signed at: ${input.signedAt}`);
  return lines(parts);
}

export interface ExerciseNoticeInput {
  orderId: string;
  grantId: string;
  holderName: string;
  options: number;
  strike: string;
  cost: string;
  paymentId: string;
  issuedAt: string;
}

export function exerciseNoticeText(input: ExerciseNoticeInput): string {
  return lines([
    "Tidecraft Robotics, Inc. — Notice of Exercise",
    `Order: ${input.orderId}`,
    `Grant: ${input.grantId}`,
    `Holder: ${input.holderName}`,
    `Options exercised: ${formatCount(input.options)}`,
    `Strike price: ${formatPricePerShare(input.strike)}`,
    `Exercise cost: ${formatMoney(input.cost)}`,
    `Payment reference: ${input.paymentId}`,
    `Issued at: ${input.issuedAt}`,
  ]);
}

export function tenderNdaText(tenderId: string, sellerName: string, signedAt: string): string {
  return lines([
    "Tidecraft Robotics, Inc. — Tender Offer Confidentiality Agreement",
    `Tender: ${tenderId}`,
    `Seller: ${sellerName}`,
    `Signed at: ${signedAt}`,
  ]);
}
