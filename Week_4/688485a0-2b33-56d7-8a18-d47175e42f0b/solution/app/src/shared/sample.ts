import type { JsonObject, JsonValue } from "./json.js";

/** The built-in houseplant collection and the landing page's sample pipeline. */

const FAMILIES = ["Araceae", "Cactaceae", "Marantaceae", "Moraceae", "Asparagaceae"];
const LIGHTS = ["low", "medium", "bright"];
const POT_SIZES = [12, 15, 18];
export const SAMPLE_SIZE = 1240;

export const SAMPLE_PIPELINE: JsonValue[] = [
  { $match: { light: "bright" } },
  { $unwind: "$pots" },
  { $group: { _id: "$family", pots: { $count: {} } } },
  { $sort: { pots: -1, _id: 1 } },
];

export function houseplants(): JsonObject[] {
  return Array.from({ length: SAMPLE_SIZE }, (_, index) => {
    const i = index + 1;
    return {
      _id: i.toString(16).padStart(24, "0"),
      name: `Plant ${i}`,
      family: FAMILIES[i % 5] as string,
      light: LIGHTS[i % 3] as string,
      water_days: 3 + (i % 12),
      pots: POT_SIZES.slice(0, i % 4),
    };
  });
}
