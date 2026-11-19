export interface RewardDelegation {
  id: string;
  amountUfern: bigint;
}

export interface RewardValidator {
  id: string;
  stakeUfern: bigint;
  commissionNumerator: bigint;
  commissionDenominator: bigint;
  delegations: RewardDelegation[];
}

export interface RewardPayout {
  validatorId: string;
  commissionUfern: bigint;
  delegations: RewardDelegation[];
}

/**
 * The published per-block split: floor by stake share, then floor the
 * commission, then floor each delegation's cut. Remainders are discarded.
 */
export function splitBlockReward(
  validators: RewardValidator[],
  totalBondedUfern: bigint,
  blockRewardUfern: bigint,
): RewardPayout[] {
  if (totalBondedUfern === 0n) return [];
  return validators.map((validator) => {
    const share = (blockRewardUfern * validator.stakeUfern) / totalBondedUfern;
    const commission =
      (share * validator.commissionNumerator) / validator.commissionDenominator;
    const distributable = share - commission;
    const delegations = validator.delegations.map((delegation) => ({
      id: delegation.id,
      amountUfern:
        validator.stakeUfern === 0n
          ? 0n
          : (distributable * delegation.amountUfern) / validator.stakeUfern,
    }));
    return { validatorId: validator.id, commissionUfern: commission, delegations };
  });
}
