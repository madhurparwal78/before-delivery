import { JsonObj } from "../../shared/values.js";
import { compileStage, parseStage, runPipeline, CompiledStage } from "../../shared/query/pipeline.js";

/**
 * The built-in houseplant sample (DP-93): 1240 documents generated identically
 * on every start and never stored as a project. The sample pipeline is exempt
 * from the scan guard.
 */

export function houseplantSample(): JsonObj[] {
  const families = ["Araceae", "Cactaceae", "Marantaceae", "Moraceae", "Asparagaceae"];
  const lights = ["low", "medium", "bright"];
  const pots = [12, 15, 18];
  const out: JsonObj[] = [];
  for (let i = 1; i <= 1240; i++) {
    const doc: JsonObj = {
      _id: i.toString(16).padStart(24, "0"),
      name: `Plant ${i}`,
      family: families[i % 5],
      light: lights[i % 3],
      water_days: 3 + (i % 12),
    };
    const potCount = i % 4;
    if (potCount > 0) {
      doc["pots"] = pots.slice(0, potCount);
    }
    out.push(doc);
  }
  return out;
}

export const SAMPLE_PIPELINE: JsonObj[] = [
  { $match: { light: "bright" } },
  { $unwind: "$pots" },
  { $group: { _id: "$family", pots: { $count: {} } } },
  { $sort: { pots: -1, _id: 1 } },
];

/** The preview answer for the landing page's hero card. */
export function sampleSieve(): {
  input: number;
  stages: { index: number; count: number; disabled: boolean; documents: JsonObj[] }[];
  pin: null;
} {
  const docs = houseplantSample();
  const compiled: CompiledStage[] = SAMPLE_PIPELINE.map((s, i) => {
    const { op, body } = parseStage(s, i);
    return { ...compileStage(op, body, i), disabled: false };
  });
  const result = runPipeline(docs, compiled, { previewDocs: 5 });
  return {
    input: docs.length,
    stages: result.stages.map(s => ({
      index: s.index,
      count: s.count,
      disabled: false,
      documents: s.documents,
    })),
    pin: null,
  };
}
