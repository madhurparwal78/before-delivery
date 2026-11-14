export const BASE = process.env.TEST_BASE_URL ?? `http://127.0.0.1:${process.env.APP_PUBLIC_PORT ?? "4173"}`;
const GRADING_KEY = process.env.GRADING_KEY ?? "";

export class Client {
  cookies = new Map<string, string>();

  constructor(session?: string) {
    if (session) this.cookies.set("nf_session", session);
  }

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any; headers: Headers; text: string }> {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const response = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
      redirect: "manual",
    });
    for (const set of response.headers.getSetCookie()) {
      const [pair] = set.split(";");
      const [k, v] = pair.split("=");
      if (v === "") this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed, headers: response.headers, text };
  }
}

export async function seed(body: unknown): Promise<any> {
  const response = await new Client().call("POST", "/api/grading/seed", body, { "X-Grading-Key": GRADING_KEY });
  if (response.status !== 201) throw new Error(`seed failed ${response.status} ${response.text}`);
  return response.body;
}

export async function setClock(now: string | null): Promise<void> {
  const response = await new Client().call("POST", "/api/grading/clock", { now }, { "X-Grading-Key": GRADING_KEY });
  if (response.status !== 200) throw new Error(`clock failed ${response.status} ${response.text}`);
}

export function unique(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

export const supper = {
  title: "Supper club RSVP",
  intro: "Tell us if you are coming.",
  pages: [
    {
      key: "about",
      title: "About you",
      questions: [
        { key: "attending", type: "choice", label: "Are you coming?", required: true, options: [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }] },
        { key: "guests", type: "number", label: "How many guests?", help: "Count yourself.", required: false, min: 1, max: 8, decimals: 0 },
      ],
      jumps: [{ name: "Not attending", when: '{attending} = "No"', to: "thanks" }],
    },
    {
      key: "meals",
      title: "Meals",
      questions: [
        { key: "meal", type: "dropdown", label: "Main course", required: true, options: [{ value: "Vegetarian", label: "Vegetarian" }, { value: "Fish", label: "Fish" }] },
        { key: "diet", type: "short_text", label: "Which diet?", required: false, max_length: 40, show_rule: { name: "Vegetarian meal", when: '{meal} = "Vegetarian"' } },
      ],
    },
    {
      key: "travel",
      title: "Travel",
      show_rule: { name: "Two or more guests", when: "{guests} >= 2" },
      questions: [{ key: "parking", type: "choice", label: "Do you need parking?", required: true, options: [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }] }],
    },
    { key: "thanks", title: "Anything else", questions: [{ key: "comment", type: "long_text", label: "Anything to add about your {{meal}} meal?", required: false }] },
  ],
  checks: [],
};

export const bakery = {
  title: "Bakery pre-order",
  pages: [
    {
      key: "order",
      title: "Your order",
      questions: [
        { key: "loaves", type: "number", label: "Loaves", decimals: 0, min: 0 },
        { key: "rolls", type: "number", label: "Rolls", decimals: 0, min: 0 },
        { key: "delivery", type: "choice", label: "Delivery", options: [{ value: "yes", label: "yes" }, { value: "no", label: "no" }] },
        { key: "people", type: "number", label: "People sharing", decimals: 0 },
        { key: "subtotal", type: "calculated", label: "Subtotal", formula: "{loaves} * 3.35 + {rolls} * 0.45", places: 2, prefix: "£" },
        { key: "discount", type: "calculated", label: "Discount", formula: "ROUND(IF({subtotal} >= 20, {subtotal} * 0.125, 0), 2)", places: 2, prefix: "£" },
        { key: "total", type: "calculated", label: "Total", formula: '{subtotal} - {discount} + IF({delivery} = "yes", 2.5, 0)', places: 2, prefix: "£" },
        { key: "each", type: "calculated", label: "Each", formula: "{total} / {people}", places: 2, prefix: "£" },
        { key: "margin", type: "calculated", label: "Margin", formula: "{total} * 0.3", places: 2, hidden: true },
        { key: "bulk_note", type: "short_text", label: "Collection time for large orders", show_rule: { name: "Large order", when: "{total} >= 20" } },
        { key: "email", type: "short_text", label: "Your email", pattern: "email" },
      ],
    },
  ],
  checks: [],
};
