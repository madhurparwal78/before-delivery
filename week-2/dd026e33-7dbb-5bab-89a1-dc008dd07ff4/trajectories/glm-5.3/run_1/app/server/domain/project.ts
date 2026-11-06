/**
 * Owner projection — the single decision place for what owners see.
 * Staff actors become the house; Kill Bill ids and transfer recorders never
 * reach an owner.
 */
export const HOUSE_ACTOR = { id: 'house', name: 'Marrow & Lark Motor House' };

export function projectActorForOwner(actor: { id: string; name: string } | null, ownerId: string): { id: string; name: string } | null {
  if (actor === null) return null;
  if (actor.id === ownerId) return actor;
  return { ...HOUSE_ACTOR };
}

export function projectInvoiceForOwner<T extends Record<string, unknown>>(invoice: T): T {
  const clone: Record<string, unknown> = { ...invoice };
  delete clone.killbill_invoice_id;
  if (Array.isArray(clone.payments)) {
    clone.payments = (clone.payments as Record<string, unknown>[]).map((payment) => {
      const projected: Record<string, unknown> = { ...payment };
      delete projected.killbill_payment_id;
      delete projected.recorded_by;
      return projected;
    });
  }
  return clone as T;
}
