// Selling price (brief: Business rules / Money), in whole tenths of a million.
export function sellingPrice(purchaseTenths: number, currentTenths: number): number {
  if (currentTenths <= purchaseTenths) return currentTenths;
  return purchaseTenths + Math.floor((currentTenths - purchaseTenths) / 2);
}
