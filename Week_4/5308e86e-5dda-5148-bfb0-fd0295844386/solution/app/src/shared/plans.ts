/** The three plans: seeded into the database and rendered on the pricing page from this one definition. */

export interface PlanDefinition {
  name: "base" | "plus" | "pro";
  title: string;
  monthlyCents: number;
  annualCents: number;
  audience: string;
  features: string[];
}

export const PLANS: PlanDefinition[] = [
  {
    name: "base",
    title: "Tallwind",
    monthlyCents: 0,
    annualCents: 0,
    audience: "banking and finance essentials",
    features: ["Free checking and savings", "Virtual Lift Cards", "Free ACH, wires and real-time payments"],
  },
  {
    name: "plus",
    title: "Tallwind Plus",
    monthlyCents: 2390,
    annualCents: 29590,
    audience: "more efficiencies and streamlined invoicing",
    features: ["Everything in Tallwind", "Recurring invoicing and reminders", "Approval rules for large payments"],
  },
  {
    name: "pro",
    title: "Tallwind Pro",
    monthlyCents: 34990,
    annualCents: 239990,
    audience: "complex operations with a relationship manager",
    features: ["Everything in Plus", "A named relationship manager", "Custom spend and approval workflows"],
  },
];
