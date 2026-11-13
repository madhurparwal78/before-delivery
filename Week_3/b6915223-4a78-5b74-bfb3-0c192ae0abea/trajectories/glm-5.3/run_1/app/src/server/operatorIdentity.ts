let operatorPocketbaseId: string | null = null;

export function setOperatorPocketbaseId(id: string): void {
  operatorPocketbaseId = id;
}

export function OPERATOR_POCKETBASE_ID(): string | null {
  return operatorPocketbaseId;
}
