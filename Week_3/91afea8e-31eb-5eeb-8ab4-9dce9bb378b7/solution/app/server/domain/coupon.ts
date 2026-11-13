export interface Coupon {
  code: string;
  kind: "percent" | "flat";
  value: number;
  capPaise: number | null;
  minSubtotalPaise: number;
  expired: boolean;
}

/** The coupon's discount on a selected subtotal, or null when the coupon doesn't apply to the cart. */
export function couponDiscount(coupon: Coupon, selectedSubtotalPaise: number): number | null {
  if (coupon.expired || selectedSubtotalPaise === 0 || selectedSubtotalPaise < coupon.minSubtotalPaise) return null;
  const raw = coupon.kind === "percent" ? Math.floor((selectedSubtotalPaise * coupon.value) / 100) : coupon.value;
  return Math.min(coupon.capPaise === null ? raw : Math.min(raw, coupon.capPaise), selectedSubtotalPaise);
}
