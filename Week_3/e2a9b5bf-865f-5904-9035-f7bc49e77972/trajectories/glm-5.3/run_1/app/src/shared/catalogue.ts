// Catalogue objects and programs, shared by browser and server.
import type { ObjectKind } from "./completeness.js";
import type { RuleEdition } from "./completeness.js";

export interface CatalogueObject {
  readonly id: string;
  readonly designation: string;
  readonly name: string;
  readonly kind: ObjectKind;
}

export const catalogue: readonly CatalogueObject[] = [
  { id: "m2", designation: "M2", name: "Globular cluster in Aquarius", kind: "globular" },
  { id: "m3", designation: "M3", name: "Globular cluster in Canes Venatici", kind: "globular" },
  { id: "m5", designation: "M5", name: "Globular cluster in Serpens", kind: "globular" },
  { id: "m8", designation: "M8", name: "Lagoon Nebula", kind: "nebula" },
  { id: "m11", designation: "M11", name: "Wild Duck Cluster", kind: "open_cluster" },
  { id: "m13", designation: "M13", name: "Great Globular Cluster in Hercules", kind: "globular" },
  { id: "m15", designation: "M15", name: "Globular cluster in Pegasus", kind: "globular" },
  { id: "m27", designation: "M27", name: "Dumbbell Nebula", kind: "planetary_nebula" },
  { id: "m31", designation: "M31", name: "Andromeda Galaxy", kind: "galaxy" },
  { id: "m42", designation: "M42", name: "Orion Nebula", kind: "nebula" },
  { id: "m45", designation: "M45", name: "Pleiades", kind: "open_cluster" },
  { id: "m51", designation: "M51", name: "Whirlpool Galaxy", kind: "galaxy" },
  { id: "m57", designation: "M57", name: "Ring Nebula", kind: "planetary_nebula" },
  { id: "m81", designation: "M81", name: "Bode's Galaxy", kind: "galaxy" },
  { id: "m82", designation: "M82", name: "Cigar Galaxy", kind: "galaxy" },
  { id: "m92", designation: "M92", name: "Globular cluster in Hercules", kind: "globular" },
  { id: "albireo", designation: "Albireo", name: "Beta Cygni", kind: "double_star" },
];

export interface ProgramSeed {
  readonly id: string;
  readonly name: string;
  readonly object_ids: readonly string[];
  readonly required_count: number;
  readonly coordinator_name: string;
  readonly coordinator_email: string;
  readonly editions: readonly RuleEdition[];
}

export const programSeeds: readonly ProgramSeed[] = [
  {
    id: "globulars-by-hand",
    name: "Globular Clusters by Hand",
    object_ids: ["m13", "m92", "m3", "m5", "m15", "m2"],
    required_count: 5,
    coordinator_name: "Odile Marsh",
    coordinator_email: "globulars@coordinators.lowlamp.test",
    editions: [
      { edition: 1, effective_from: "2000-01-01", min_description: 60, sketch_required: true, concentration_required: false, pair_required: false },
      { edition: 2, effective_from: "2026-09-01", min_description: 80, sketch_required: true, concentration_required: true, pair_required: false },
    ],
  },
  {
    id: "twelve-showpieces",
    name: "Twelve Showpieces",
    object_ids: ["m13", "albireo", "m51", "m57", "m27", "m31", "m42", "m45", "m81", "m82", "m8", "m11"],
    required_count: 10,
    coordinator_name: "Bram Ellery",
    coordinator_email: "showpieces@coordinators.lowlamp.test",
    editions: [
      { edition: 1, effective_from: "2000-01-01", min_description: 40, sketch_required: false, concentration_required: false, pair_required: false },
      { edition: 2, effective_from: "2026-10-01", min_description: 40, sketch_required: false, concentration_required: false, pair_required: true },
    ],
  },
];
