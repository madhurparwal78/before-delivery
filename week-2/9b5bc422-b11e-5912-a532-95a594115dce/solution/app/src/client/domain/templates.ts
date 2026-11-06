import type { BlockType } from "./types.ts";

type TemplateBlock = { type: BlockType; text: string };
export type Template = { name: string; category: string; description: string; blocks: TemplateBlock[] };

export const TEMPLATE_CATEGORIES = ["All", "Journal", "Planning", "Reading"];

export const TEMPLATES: Template[] = [
  {
    name: "Daily note",
    category: "Journal",
    description: "A short note for one day.",
    blocks: [
      { type: "heading2", text: "Today" },
      { type: "todo", text: "One thing to finish" },
      { type: "heading2", text: "Notes" },
      { type: "paragraph", text: "" },
    ],
  },
  {
    name: "Weekly review",
    category: "Journal",
    description: "Look back at the week in ten minutes.",
    blocks: [
      { type: "heading2", text: "What went well" },
      { type: "paragraph", text: "" },
      { type: "heading2", text: "What to change" },
      { type: "todo", text: "Pick one change for next week" },
    ],
  },
  {
    name: "Meeting notes",
    category: "Planning",
    description: "Who came, what was decided, what is next.",
    blocks: [
      { type: "heading2", text: "Who was there" },
      { type: "bulleted", text: "Name" },
      { type: "heading2", text: "Decisions" },
      { type: "todo", text: "Next step" },
    ],
  },
  {
    name: "Trip plan",
    category: "Planning",
    description: "Travel, beds and bookings on one page.",
    blocks: [
      { type: "heading2", text: "Getting there" },
      { type: "heading2", text: "Where to stay" },
      { type: "todo", text: "Book the first night" },
    ],
  },
  {
    name: "Book notes",
    category: "Reading",
    description: "Keep the lines and thoughts from a book.",
    blocks: [
      { type: "heading2", text: "Why I picked it up" },
      { type: "quote", text: "A line worth keeping" },
      { type: "heading2", text: "What stays with me" },
    ],
  },
  {
    name: "Reading list",
    category: "Reading",
    description: "Books to read next, ticked off as you go.",
    blocks: [
      { type: "todo", text: "First book on the list" },
      { type: "todo", text: "Second book on the list" },
    ],
  },
];

export const DAILY_NOTE = TEMPLATES[0] as Template;
