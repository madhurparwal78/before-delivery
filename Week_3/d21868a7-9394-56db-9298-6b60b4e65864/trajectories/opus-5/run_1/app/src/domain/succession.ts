/** Holder succession for an open gate card. */

export interface SuccessionInputs {
  standbyCode: string | null;
  rosteredOperator: string;
  removedCode: string;
  isUsable: (operatorCode: string) => boolean;
}

export interface SuccessionResult {
  holderCode: string;
  clearStandby: boolean;
}

/**
 * A moved card goes to the order's named standby, or else to the window's
 * rostered operator, skipping an erased operator and the operator being removed.
 */
export function pickSuccessor(inputs: SuccessionInputs): SuccessionResult | null {
  const { standbyCode, rosteredOperator, removedCode, isUsable } = inputs;
  if (standbyCode !== null && standbyCode !== removedCode && isUsable(standbyCode)) {
    return { holderCode: standbyCode, clearStandby: true };
  }
  if (rosteredOperator !== removedCode && isUsable(rosteredOperator)) {
    return { holderCode: rosteredOperator, clearStandby: false };
  }
  return null;
}
