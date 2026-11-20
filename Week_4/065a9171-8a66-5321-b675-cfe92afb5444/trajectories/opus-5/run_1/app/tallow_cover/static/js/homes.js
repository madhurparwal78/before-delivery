// The group's homes and units, as named in the brief's seed data. The API
// publishes ids rather than a home list, so the rail, the queue filter, the
// attendance picker and the export form all read these names from here.

export const HOMES = [
  {
    id: "larchfield",
    name: "Larchfield House",
    units: [
      { id: "larchfield-rowan", name: "Rowan" },
      { id: "larchfield-willow", name: "Willow" },
    ],
  },
  {
    id: "brackenmoor",
    name: "Brackenmoor Lodge",
    units: [{ id: "brackenmoor-heather", name: "Heather" }],
  },
];

export function homesFor(me) {
  if (me.role === "hr_admin") return HOMES;
  return HOMES.filter((home) => home.id === me.home_id);
}

export function homeName(homeId) {
  return HOMES.find((home) => home.id === homeId)?.name || homeId;
}

export function unitName(unitId) {
  for (const home of HOMES) {
    const unit = home.units.find((candidate) => candidate.id === unitId);
    if (unit) return unit.name;
  }
  return unitId;
}

export function unitsFor(me) {
  return homesFor(me).flatMap((home) => home.units);
}
