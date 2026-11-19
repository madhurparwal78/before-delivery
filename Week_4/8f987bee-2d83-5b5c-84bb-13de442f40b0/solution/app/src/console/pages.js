export const PAGES = [
  { to: "/app", label: "Connections", end: true },
  { to: "/app/sources", label: "Sources" },
  { to: "/app/destinations", label: "Destinations" },
  { to: "/app/builder", label: "Builder" },
  { to: "/app/members", label: "Members", role: "admin" },
  { to: "/app/audit", label: "Audit log", role: "admin" },
  { to: "/app/settings", label: "Settings" },
];

// The console pages a role may not open; every other /app page is open to every signed-in member.
const RESTRICTED = {
  "/app/members": ["admin"],
  "/app/audit": ["admin"],
  "/app/connections/new": ["admin", "editor"],
};

export function mayOpen(pathname, role) {
  return RESTRICTED[pathname.replace(/\/+$/, "")]?.includes(role) ?? true;
}
