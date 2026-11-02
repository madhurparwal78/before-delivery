import { allocate } from "./money.js";
/** Flattens parts in the brief's order: each line's goods then deposit, then shipping, then taxes. */
function flatten(parts) {
    return [
        ...parts.lines.flatMap((l) => [l.discountedGoodsCents, l.depositCents]),
        parts.shippingCents,
        ...parts.taxes.map((t) => t.cents),
    ];
}
function flattenSplit(split) {
    return [
        ...split.lines.flatMap((l) => [l.goods_cents, l.deposit_cents]),
        split.shipping_cents,
        ...split.taxes.map((t) => t.cents),
    ];
}
/**
 * The refund split: the amount is allocated over each part's remaining refundable cents by
 * largest remainder, ties to the earlier part. `earlier` holds the splits of applied and
 * pending refunds already taken from this order.
 */
export function splitRefund(parts, earlier, amountCents) {
    const remaining = flatten(parts);
    for (const split of earlier) {
        flattenSplit(split).forEach((cents, i) => {
            remaining[i] -= cents;
        });
    }
    const shares = allocate(amountCents, remaining);
    let at = 0;
    const take = () => shares[at++];
    return {
        lines: parts.lines.map((l) => ({ flavour: l.flavour, goods_cents: take(), deposit_cents: take() })),
        shipping_cents: take(),
        taxes: parts.taxes.map((t) => ({ name: t.name, cents: take() })),
    };
}
