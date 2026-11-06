// Seeded plans (brief: Seed data). The marketing pricing table and the server read the same rows.

interface Plan {
  id: "sandbox" | "indie";
  name: string;
  monthlyPrice: string;
  includedStorageBytes: number;
  includedEgressBytes: number;
  storageOverage: string;
  egressOverage: string;
  requestUnits: string;
  killbillPlan: string;
}

export const PLANS: readonly Plan[] = [
  {
    id: "sandbox",
    name: "Sandbox",
    monthlyPrice: "$0.00",
    includedStorageBytes: 1_000_000,
    includedEgressBytes: 2_000_000,
    storageOverage: "none",
    egressOverage: "none",
    requestUnits: "none",
    killbillPlan: "farshore-sandbox-monthly",
  },
  {
    id: "indie",
    name: "Indie",
    monthlyPrice: "$19.00",
    includedStorageBytes: 50_000_000_000,
    includedEgressBytes: 100_000_000_000,
    storageOverage: "$0.006 per GB-month, billed by the GB-hour",
    egressOverage: "$0.010 per GB",
    requestUnits: "$0.40 per million",
    killbillPlan: "farshore-indie-monthly",
  },
];
