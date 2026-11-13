const FREE_DELIVERY_FROM_PAISE = 49_900;
const STANDARD_DELIVERY_FEE_PAISE = 4_000;
const ONE_DAY_DELIVERY_FEE_PAISE = 9_900;
export const GIFT_WRAP_FEE_PAISE = 3_000;
export const COD_FEE_PAISE = 2_500;
export const COD_CAP_PAISE = 5_000_000;
export const EMI_MINIMUM_PAISE = 300_000;
export const MAX_LINE_QUANTITY = 10;
export const MAX_CART_LINES = 10;
export const MAX_SAVED_LINES = 50;
export const MAX_OPEN_COD_ORDERS = 3;

export type DeliverySpeed = "standard" | "one_day";

export function parcelDeliveryFee(selectedSubtotalPaise: number, speed: DeliverySpeed): number {
  if (speed === "one_day") return ONE_DAY_DELIVERY_FEE_PAISE;
  return selectedSubtotalPaise >= FREE_DELIVERY_FROM_PAISE ? 0 : STANDARD_DELIVERY_FEE_PAISE;
}
