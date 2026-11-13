import type { Role, StaffRole } from "./enums.js";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
};

export type SessionUser = {
  id: string;
  name: string;
  role: Role;
};

export const HOME_ROUTES: Record<Role, string> = {
  member: "/me",
  owner: "/staff/members",
  specialist: "/staff/results",
  coordinator: "/staff/calendar",
  billingLead: "/staff/receipts",
};

export const STAFF_ROLES: StaffRole[] = ["owner", "specialist", "coordinator", "billingLead"];

export const STAFF_NAV: Record<StaffRole, { label: string; href: string }[]> = {
  owner: [
    { label: "Members", href: "/staff/members" },
    { label: "Care messages", href: "/staff/messages" },
    { label: "Draw calendar", href: "/staff/calendar" },
    { label: "Results to release", href: "/staff/results" },
    { label: "Range table", href: "/staff/ranges" },
    { label: "Receipts", href: "/staff/receipts" },
    { label: "Team", href: "/staff/team" },
  ],
  specialist: [
    { label: "Members", href: "/staff/members" },
    { label: "Care messages", href: "/staff/messages" },
    { label: "Results to release", href: "/staff/results" },
  ],
  coordinator: [
    { label: "Members", href: "/staff/members" },
    { label: "Care messages", href: "/staff/messages" },
    { label: "Draw calendar", href: "/staff/calendar" },
  ],
  billingLead: [{ label: "Members", href: "/staff/members" }, { label: "Receipts", href: "/staff/receipts" }],
};

export const MEMBER_NAV = [
  { label: "Home", href: "/me" },
  { label: "Membership", href: "/me/membership" },
  { label: "Draws", href: "/me/draws" },
  { label: "Results", href: "/me/results" },
  { label: "Plan", href: "/me/plan" },
  { label: "Messages", href: "/me/messages" },
  { label: "Records", href: "/me/records" },
  { label: "Account", href: "/me/account" },
];

export const PARTNERS = [
  "Saguaro Diagnostics",
  "Mesa Clinical Labs",
  "Copperline Pathology",
  "Bluebird Assay Partners",
  "Red Rock Reference Lab",
  "Palo Verde Analytics",
];

export const PRACTICE = {
  name: "Ocotillo Longevity Club",
  address: "8820 E Desert Willow Way, Suite 140, Scottsdale, AZ 85258",
  taxNumber: "86-4172093",
};
