import { z } from "zod";
import { fieldsOf, validationFailed } from "./errors.js";

const prompt = z.string().trim().min(1, "Prompt must be 1 to 200 characters").max(200, "Prompt must be 1 to 200 characters");
const timeLimitSeconds = z
  .number("Time limit must be a whole number of seconds")
  .int("Time limit must be a whole number of seconds")
  .min(5, "Time limit must be 5 to 120 seconds")
  .max(120, "Time limit must be 5 to 120 seconds");
const optionText = z.string().trim().min(1, "Each option must be 1 to 80 characters").max(80, "Each option must be 1 to 80 characters");
const finite = (label: string) => z.number(`${label} must be a number`);

const multipleChoice = z
  .object({
    type: z.literal("multiple_choice"),
    prompt,
    timeLimitSeconds,
    options: z.array(optionText, "Give 2 to 4 options").min(2, "Give 2 to 4 options").max(4, "Give 2 to 4 options"),
    correctIndex: z.number("Choose the correct option").int("Choose the correct option"),
  })
  .superRefine((q, ctx) => {
    if (q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      ctx.addIssue({ code: "custom", path: ["correctIndex"], message: "Choose one of the options as correct" });
    }
  });

const estimate = z
  .object({
    type: z.literal("estimate"),
    prompt,
    timeLimitSeconds,
    min: finite("Minimum"),
    max: finite("Maximum"),
    step: finite("Step"),
    answer: finite("Correct value"),
    tolerance: finite("Tolerance"),
    unit: z.string("Unit must be text").trim().max(20, "Unit must be 0 to 20 characters"),
  })
  .superRefine((q, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (q.min >= q.max) issue("max", "Maximum must be above the minimum");
    if (q.step <= 0) issue("step", "Step must be above zero");
    if (q.answer < q.min || q.answer > q.max) issue("answer", "Correct value must lie between minimum and maximum");
    if (q.tolerance < 0 || q.tolerance > q.max - q.min) issue("tolerance", "Tolerance must be from 0 to the full range");
  });

const sequence = z
  .object({
    type: z.literal("sequence"),
    prompt,
    timeLimitSeconds,
    items: z
      .array(z.string().trim().min(1, "Each item must be 1 to 80 characters").max(80, "Each item must be 1 to 80 characters"), "Give 3 to 6 items")
      .min(3, "Give 3 to 6 items")
      .max(6, "Give 3 to 6 items"),
  })
  .superRefine((q, ctx) => {
    if (new Set(q.items.map((item) => item.toLowerCase())).size !== q.items.length) {
      ctx.addIssue({ code: "custom", path: ["items"], message: "Items must be different from each other" });
    }
  });

const questionInput = z.discriminatedUnion("type", [multipleChoice, estimate, sequence], "Choose a question type");
type QuestionInput = z.infer<typeof questionInput>;

// The one place that decides whether question fields are acceptable.
export function parseQuestionInput(body: unknown): QuestionInput {
  const parsed = questionInput.safeParse(body);
  if (parsed.success) return parsed.data;
  throw validationFailed(fieldsOf(parsed.error));
}

type StoredFields = Record<string, unknown>;

export function storedFields(q: QuestionInput): StoredFields {
  switch (q.type) {
    case "multiple_choice":
      return { options: q.options, correctIndex: q.correctIndex };
    case "estimate":
      return { min: q.min, max: q.max, step: q.step, answer: q.answer, tolerance: q.tolerance, unit: q.unit };
    case "sequence":
      return { items: q.items };
  }
}
