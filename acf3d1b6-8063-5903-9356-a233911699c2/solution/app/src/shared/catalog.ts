// Fixed content shipped with the app: plans, models, examples and starter templates.
// The plan limits and the cost of a generation are decided here and nowhere else.

export type Role = 'owner' | 'member';
export type CreditKind = 'plan' | 'seat' | 'charge' | 'refund';

export type PlanId = 'free' | 'standard' | 'pro' | 'max' | 'team' | 'enterprise';
export type WorkspacePlanId = Exclude<PlanId, 'enterprise'>;

export interface Plan {
  id: PlanId;
  name: string;
  monthly_price: number | null;
  yearly_price: number | null;
  credits: number | null;
  parallel_limit: number | null;
  project_limit: number | null;
}

export const PLANS: Plan[] = [
  { id: 'free', name: 'Free', monthly_price: 0, yearly_price: 0, credits: 125, parallel_limit: 2, project_limit: 1 },
  { id: 'standard', name: 'Standard', monthly_price: 1500, yearly_price: 1200, credits: 625, parallel_limit: 5, project_limit: 3 },
  { id: 'pro', name: 'Pro', monthly_price: 3500, yearly_price: 2800, credits: 2250, parallel_limit: 15, project_limit: 5 },
  { id: 'max', name: 'Max', monthly_price: 9500, yearly_price: 7600, credits: 9500, parallel_limit: 20, project_limit: 10 },
  { id: 'team', name: 'Team', monthly_price: 6900, yearly_price: 5500, credits: 6900, parallel_limit: 24, project_limit: 100 },
  { id: 'enterprise', name: 'Enterprise', monthly_price: null, yearly_price: null, credits: null, parallel_limit: null, project_limit: null },
];

export const SEAT_CREDITS = planOf('team').credits;
export const SEAT_LIMIT = 9;

/** A workspace plan's credits and limits are always numbers; only Enterprise has none. */
type WorkspacePlan = { [K in keyof Plan]: NonNullable<Plan[K]> };

export function planOf(id: WorkspacePlanId): WorkspacePlan {
  return PLANS.find((plan) => plan.id === id) as WorkspacePlan;
}

/** "Standard, 625 credits a month", "Free, 125 credits once", "Team, 6,900 credits per seat". */
export function planLine(id: WorkspacePlanId): string {
  const plan = planOf(id);
  const credits = formatNumber(plan.credits);
  if (id === 'free') return `${plan.name}, ${credits} credits once`;
  if (id === 'team') return `${plan.name}, ${credits} credits per seat`;
  return `${plan.name}, ${credits} credits a month`;
}

export type ModelId = 'vela-4.5' | 'vela-4-turbo' | 'vela-image-4';

export interface Model {
  id: ModelId;
  name: string;
  kind: 'video' | 'image';
  credits_per_unit: number;
}

export const MODELS: Model[] = [
  { id: 'vela-4.5', name: 'Vela 4.5', kind: 'video', credits_per_unit: 12 },
  { id: 'vela-4-turbo', name: 'Vela 4 Turbo', kind: 'video', credits_per_unit: 6 },
  { id: 'vela-image-4', name: 'Vela Image 4', kind: 'image', credits_per_unit: 8 },
];

export function modelOf(id: string): Model | undefined {
  return MODELS.find((model) => model.id === id);
}

export const DURATIONS = [5, 10] as const;

/** A generation is Ready this many seconds after it starts. */
export const RENDER_SECONDS = 12;
export const IMAGE_COUNT_MIN = 1;
export const IMAGE_COUNT_MAX = 4;
export const ASPECTS = ['16:9', '9:16', '1:1'] as const;
export type Aspect = (typeof ASPECTS)[number];

/** Credits per second of video or per image, times the seconds or the images. */
export function generationCost(model: Model, duration: number | null, imageCount: number | null): number {
  return model.credits_per_unit * (model.kind === 'video' ? duration! : imageCount!);
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatCredits(n: number): string {
  return `${formatNumber(n)} credits`;
}

export type ExampleCategory = 'product-ads' | 'animated-stories' | 'ugc' | 'from-a-link';

export interface Example {
  heading: string;
  category: ExampleCategory;
  prompt: string;
}

export const EXAMPLE_CATEGORIES: { id: ExampleCategory; label: string }[] = [
  { id: 'product-ads', label: 'Product ads' },
  { id: 'animated-stories', label: 'Animated stories' },
  { id: 'ugc', label: 'UGC' },
  { id: 'from-a-link', label: 'From a link' },
];

const EXAMPLES: Example[] = [
  {
    heading: 'Product shot to finished commercial',
    category: 'product-ads',
    prompt:
      'Make one complete stovetop coffee commercial for this kettle: onto the blue flame, water in, the steam curling up, then the pour and the cup in morning light. One kitchen, every shot in the same light.',
  },
  {
    heading: 'Five-shot brand film from one cup',
    category: 'product-ads',
    prompt:
      'A five-shot sequence: a coffee cup on a sunlit café table, small clouds rising from the steam and carrying the camera over misty hills of coffee plants, then back to the table.',
  },
  {
    heading: 'Product sheet to brand spot',
    category: 'product-ads',
    prompt:
      "Make a thirty-second cereal ad from these three boxes: a child's imagination turns the cereal rings into giant hoops rolling across a beach at sunset, then back to the breakfast table.",
  },
  {
    heading: 'Animated story with consistent characters',
    category: 'animated-stories',
    prompt:
      'Turn this tomato soldier into a twenty-second animated parody: he storms the beach with his vegetable squad to get the ketchup to the fries. Keep the characters consistent in every shot, no text on screen.',
  },
  {
    heading: 'Animated comedy scene',
    category: 'animated-stories',
    prompt:
      'An undercover escape scene in a soft animated style: the chicken looks both ways, runs over to a sleeping dog, looks around, then taps him with its beak.',
  },
  {
    heading: 'UGC-style product video',
    category: 'ugc',
    prompt:
      'Make a fifteen-second vertical ad for this chair: a guy films himself in his apartment, flops into it, hard cuts, handheld, real reactions.',
  },
  {
    heading: 'UGC demo video',
    category: 'ugc',
    prompt:
      'Make a fifteen-second clip for this hose-end lawn sprayer: a person filming himself in his own front yard at golden hour, hooking it up, spraying the lawn and talking to camera.',
  },
  {
    heading: 'Product page to cinematic spot',
    category: 'from-a-link',
    prompt:
      'Make a fifteen-second cinematic commercial from this product page for a running shoe: macro details, a slow orbit, dramatic red and black lighting, ending on the full silhouette.',
  },
];

/** The examples of one category (or all), whose heading or prompt contains the trimmed text, ignoring case. */
export function findExamples(category: string | undefined, search: string | undefined): Example[] {
  const needle = (search ?? '').trim().toLowerCase();
  return EXAMPLES.filter(
    (example) =>
      (!category || example.category === category) &&
      (!needle || `${example.heading}\n${example.prompt}`.toLowerCase().includes(needle)),
  );
}

interface Template {
  title: string;
  prompt: string;
}

export const TEMPLATE_TABS: { name: string; templates: Template[] }[] = [
  {
    name: 'Marketing campaigns',
    templates: [
      { title: 'Make video ad for socials', prompt: 'A fifteen second vertical ad for a reusable water bottle: a cyclist pauses at golden hour, drinks, and rides on' },
      { title: 'Reshoot your product', prompt: 'A glass perfume bottle on wet black stone, slow orbit, soft rim light' },
      { title: 'Build creative from a brief', prompt: 'A cosy autumn launch film for a knitwear label: a cabin porch, falling leaves, warm window light' },
      { title: 'Generate A/B variants', prompt: 'A sneaker on a concrete plinth, first in hard noon light, then in soft overcast light' },
      { title: 'Create seasonal campaign', prompt: 'A winter window display for a bookshop, snow drifting past warm lamplight' },
    ],
  },
  {
    name: 'Movies',
    templates: [
      { title: 'Open on a wide establishing shot', prompt: 'A slow aerial push over a fog-filled valley at first light, a lone train crossing a stone viaduct' },
      { title: 'Stage a quiet two-hander', prompt: 'Two strangers share an umbrella at a night bus stop, rain streaking through amber streetlight' },
      { title: 'Cut a chase beat', prompt: 'A courier on a bicycle weaves through a crowded market at dusk, handheld camera close behind' },
    ],
  },
  {
    name: 'Social media',
    templates: [
      { title: 'Loop a satisfying moment', prompt: 'Honey slowly folding onto a stack of pancakes, soft morning window light, close macro' },
      { title: 'Show a day in the studio', prompt: 'A ceramicist trims a bowl on a spinning wheel, dust floating in a shaft of afternoon sun' },
      { title: 'Tease a launch', prompt: 'A sealed box on a pastel set, the lid lifting to reveal a soft glow, slow push in' },
    ],
  },
  {
    name: 'Educational content',
    templates: [
      { title: 'Explain a process', prompt: 'A cutaway of a seed sprouting underground, roots spreading through layered soil, calm time-lapse' },
      { title: 'Visualise the weather', prompt: 'Warm and cold air meeting over a coastline, clouds forming in soft bands, top-down view' },
      { title: 'Tour a place in history', prompt: 'A slow walk through a lantern-lit Roman market street at dusk, stalls of fruit and cloth' },
    ],
  },
  {
    name: 'Experimental art',
    templates: [
      { title: 'Paint with light', prompt: 'Ribbons of violet and orange light folding through dark water, slow and weightless' },
      { title: 'Dissolve a portrait', prompt: 'A face drawn in drifting sand that scatters into birds and reforms, muted desert palette' },
      { title: 'Build an impossible room', prompt: 'A quiet room whose walls fold open like paper onto a starlit sea, gentle camera drift' },
    ],
  },
  {
    name: 'Other',
    templates: [
      { title: 'Make a moving postcard', prompt: 'A seaside town at golden hour, gulls circling over pastel houses, waves rolling in' },
      { title: 'Set a calm backdrop', prompt: 'Soft clouds sliding past a pale mountain ridge, slow and steady, no people' },
    ],
  },
];

export const COMPANY_SIZES = ['1-200', '201-1,000', '1,001-5,000', '5,001-10,000', '10,001+'];

export const INDUSTRIES = [
  'Architecture & Real Estate',
  'Automotive',
  'Creative Agency',
  'Financial Services',
  'Gaming',
  'Healthcare',
  'Media & Entertainment',
  'Professional Services',
  'Consumer Goods & Retail',
  'Software & Telecom',
  'Travel & Hospitality',
  'Other',
];

export const PRODUCTS: { id: string; label: string }[] = [
  { id: 'creative-platform', label: 'Creative Platform' },
  { id: 'api', label: 'API' },
  { id: 'model-weights-licensing', label: 'Model Weights Licensing' },
  { id: 'kinora-ads', label: 'Kinora Ads' },
];
