export type PlanId = 'free' | 'standard' | 'pro' | 'max' | 'team' | 'enterprise';

export interface Plan {
  id: PlanId;
  name: string;
  monthly_price: number | null;
  yearly_price: number | null;
  credits: number | null;
  parallel_limit: number | null;
  project_limit: number | null;
}

export interface PlanCard extends Plan {
  priceSuffix: string;
  yearlyNote: string;
  creditsLine: string;
  creditsTip: string;
  description: string;
  cta: string;
  ctaHref: string;
  features: string[];
  badge?: string;
  tab?: string;
  family: 'individual' | 'team';
}

export const PLAN_CARDS: PlanCard[] = [
  {
    id: 'free',
    name: 'Free',
    monthly_price: 0,
    yearly_price: 0,
    credits: 125,
    parallel_limit: 2,
    project_limit: 1,
    priceSuffix: '/month',
    yearlyNote: 'Free forever.',
    creditsLine: '125 credits (one time)',
    creditsTip: "125 one-time credits to explore Kinora's AI tools.",
    description: "For people looking to explore Kinora's AI Tools",
    cta: 'Start Free',
    ctaHref: '/signup',
    features: [
      'A selection of generative creative models to test concepts',
      'Up to 1 project',
      '2 generations at a time'
    ],
    family: 'individual'
  },
  {
    id: 'standard',
    name: 'Standard',
    monthly_price: 1500,
    yearly_price: 1200,
    credits: 625,
    parallel_limit: 5,
    project_limit: 3,
    priceSuffix: '/month',
    yearlyNote: 'Billed annually. Save $36/year.',
    creditsLine: '625 credits /mo',
    creditsTip: '625 credits monthly = 52s of Vela 4.5, 104s of Vela 4 Turbo, or 78 Vela Image 4 images.',
    description: 'For curious creators trying AI video',
    cta: 'Get Standard',
    ctaHref: '/enterprise-contact',
    features: ['Access to all Vela models', '5 generations at a time', 'Up to 3 projects', 'No watermarks'],
    family: 'individual'
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly_price: 3500,
    yearly_price: 2800,
    credits: 2250,
    parallel_limit: 15,
    project_limit: 5,
    priceSuffix: '/month',
    yearlyNote: 'Billed annually. Save $84/year.',
    creditsLine: '2,250 credits /mo',
    creditsTip: '2,250 credits monthly = 187s of Vela 4.5, 375s of Vela 4 Turbo, or 281 Vela Image 4 images.',
    description: 'For creators leveling up their craft',
    cta: 'Get Pro',
    ctaHref: '/enterprise-contact',
    features: ['Everything in Standard', '15 generations at a time', 'Up to 5 projects'],
    tab: 'Popular',
    family: 'individual'
  },
  {
    id: 'max',
    name: 'Max',
    monthly_price: 9500,
    yearly_price: 7600,
    credits: 9500,
    parallel_limit: 20,
    project_limit: 10,
    priceSuffix: '/month',
    yearlyNote: 'Billed annually. Save $228/year.',
    creditsLine: '9,500 credits /mo',
    creditsTip: '9,500 credits monthly = 791s of Vela 4.5, 1,583s of Vela 4 Turbo, or 1,187 Vela Image 4 images.',
    description: 'Best value for heavy solo usage',
    cta: 'Get Max',
    ctaHref: '/enterprise-contact',
    features: ['Early access to new models', '20 generations at a time', 'Up to 10 projects'],
    tab: 'Best value',
    badge: 'Credits roll over 1 mo.',
    family: 'individual'
  },
  {
    id: 'team',
    name: 'Team',
    monthly_price: 6900,
    yearly_price: 5500,
    credits: 6900,
    parallel_limit: 24,
    project_limit: 100,
    priceSuffix: 'per seat per month',
    yearlyNote: 'billed yearly, 20% off',
    creditsLine: '6,900 credits per seat per month, pooled across the workspace',
    creditsTip: 'Every seat adds 6,900 credits a month to one shared pool.',
    description: 'Best for fast-moving teams with high production needs',
    cta: 'Get Team',
    ctaHref: '/enterprise-contact',
    features: [
      'Everything in Max',
      'Up to 100 shared projects',
      'One shared credit pool',
      '24 parallel generations',
      'Two to nine seats'
    ],
    family: 'team'
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    monthly_price: null,
    yearly_price: null,
    credits: null,
    parallel_limit: null,
    project_limit: null,
    priceSuffix: '',
    yearlyNote: '',
    creditsLine: 'Pricing and credits sized to your organization',
    creditsTip: 'Credits are sized with our sales team to fit your organization.',
    description: 'Built for organizations: security, privacy, admin controls and SSO',
    cta: 'Talk to Sales',
    ctaHref: '/enterprise-contact',
    features: [
      'Everything in Team',
      'Unlimited members and workspaces',
      'Custom SSO, SOC 2 and ISO/IEC 27001, no training on your data'
    ],
    family: 'team'
  }
];

export const PLANS: Plan[] = PLAN_CARDS.map((p) => ({
  id: p.id,
  name: p.name,
  monthly_price: p.monthly_price,
  yearly_price: p.yearly_price,
  credits: p.credits,
  parallel_limit: p.parallel_limit,
  project_limit: p.project_limit
}));

export function planById(id: string): PlanCard | undefined {
  return PLAN_CARDS.find((p) => p.id === id);
}

export const SEAT_CREDITS = 6900;
export const SEAT_LIMIT = 9;

export type ModelId = 'vela-4.5' | 'vela-4-turbo' | 'vela-image-4';

export interface VideoModel {
  id: ModelId;
  name: string;
  kind: 'video' | 'image';
  credits_per_unit: number;
  blurb: string;
}

export const MODELS: VideoModel[] = [
  {
    id: 'vela-4.5',
    name: 'Vela 4.5',
    kind: 'video',
    credits_per_unit: 12,
    blurb: 'Our most cinematic model. Rich motion, steady characters and controllable light.'
  },
  {
    id: 'vela-4-turbo',
    name: 'Vela 4 Turbo',
    kind: 'video',
    credits_per_unit: 6,
    blurb: 'Half the credits, built for fast exploration and variant sweeps.'
  },
  {
    id: 'vela-image-4',
    name: 'Vela Image 4',
    kind: 'image',
    credits_per_unit: 8,
    blurb: 'Still frames with the same world model: boards, stills and product shots.'
  }
];

export function modelById(id: string): VideoModel | undefined {
  return MODELS.find((m) => m.id === id);
}

/** The one place a generation's price in credits is decided. */
export function generationCost(model: VideoModel, duration: number | null, imageCount: number | null): number {
  return model.kind === 'video' ? model.credits_per_unit * (duration ?? 0) : model.credits_per_unit * (imageCount ?? 0);
}

export type ExampleCategory = 'product-ads' | 'animated-stories' | 'ugc' | 'from-a-link';

export interface Example {
  heading: string;
  category: ExampleCategory;
  prompt: string;
}

export const EXAMPLE_TABS: { id: 'all' | ExampleCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'product-ads', label: 'Product ads' },
  { id: 'animated-stories', label: 'Animated stories' },
  { id: 'ugc', label: 'UGC' },
  { id: 'from-a-link', label: 'From a link' }
];

export const EXAMPLES: Example[] = [
  {
    heading: 'Product shot to finished commercial',
    category: 'product-ads',
    prompt:
      'Make one complete stovetop coffee commercial for this kettle: onto the blue flame, water in, the steam curling up, then the pour and the cup in morning light. One kitchen, every shot in the same light.'
  },
  {
    heading: 'Five-shot brand film from one cup',
    category: 'product-ads',
    prompt:
      'A five-shot sequence: a coffee cup on a sunlit caf\u00e9 table, small clouds rising from the steam and carrying the camera over misty hills of coffee plants, then back to the table.'
  },
  {
    heading: 'Product sheet to brand spot',
    category: 'product-ads',
    prompt:
      "Make a thirty-second cereal ad from these three boxes: a child's imagination turns the cereal rings into giant hoops rolling across a beach at sunset, then back to the breakfast table."
  },
  {
    heading: 'Animated story with consistent characters',
    category: 'animated-stories',
    prompt:
      'Turn this tomato soldier into a twenty-second animated parody: he storms the beach with his vegetable squad to get the ketchup to the fries. Keep the characters consistent in every shot, no text on screen.'
  },
  {
    heading: 'Animated comedy scene',
    category: 'animated-stories',
    prompt:
      'An undercover escape scene in a soft animated style: the chicken looks both ways, runs over to a sleeping dog, looks around, then taps him with its beak.'
  },
  {
    heading: 'UGC-style product video',
    category: 'ugc',
    prompt:
      'Make a fifteen-second vertical ad for this chair: a guy films himself in his apartment, flops into it, hard cuts, handheld, real reactions.'
  },
  {
    heading: 'UGC demo video',
    category: 'ugc',
    prompt:
      'Make a fifteen-second clip for this hose-end lawn sprayer: a person filming himself in his own front yard at golden hour, hooking it up, spraying the lawn and talking to camera.'
  },
  {
    heading: 'Product page to cinematic spot',
    category: 'from-a-link',
    prompt:
      'Make a fifteen-second cinematic commercial from this product page for a running shoe: macro details, a slow orbit, dramatic red and black lighting, ending on the full silhouette.'
  }
];

/** The one place the prompt library is narrowed, used by the page and the API. */
export function filterExamples(category: string | undefined, search: string | undefined): Example[] {
  const needle = (search ?? '').trim().toLowerCase();
  return EXAMPLES.filter((example) => {
    if (category && category !== 'all' && example.category !== category) return false;
    if (!needle) return true;
    return example.heading.toLowerCase().includes(needle) || example.prompt.toLowerCase().includes(needle);
  });
}

export interface Template {
  title: string;
  prompt: string;
}

export const TEMPLATE_TABS: { id: string; label: string; cards: Template[] }[] = [
  {
    id: 'marketing-campaigns',
    label: 'Marketing campaigns',
    cards: [
      {
        title: 'Make video ad for socials',
        prompt:
          'A fifteen second vertical ad for a reusable water bottle: a cyclist pauses at golden hour, drinks, and rides on'
      },
      {
        title: 'Reshoot your product',
        prompt: 'A glass perfume bottle on wet black stone, slow orbit, soft rim light'
      },
      {
        title: 'Build creative from a brief',
        prompt:
          'A cosy autumn launch film for a knitwear label: a cabin porch, falling leaves, warm window light'
      },
      {
        title: 'Generate A/B variants',
        prompt: 'A sneaker on a concrete plinth, first in hard noon light, then in soft overcast light'
      },
      {
        title: 'Create seasonal campaign',
        prompt: 'A winter window display for a bookshop, snow drifting past warm lamplight'
      }
    ]
  },
  {
    id: 'movies',
    label: 'Movies',
    cards: [
      {
        title: 'Open on a landscape',
        prompt: 'A wide opening shot of a valley under moving cloud shadow, slow drift forward at dawn'
      },
      {
        title: 'Quiet character beat',
        prompt: 'A lighthouse keeper watching rain run down the glass, lamp turning behind her'
      },
      {
        title: 'Chase in one take',
        prompt: 'A night chase through narrow market streets, lanterns streaking past the camera'
      }
    ]
  },
  {
    id: 'social-media',
    label: 'Social media',
    cards: [
      {
        title: 'Vertical hook in three seconds',
        prompt: 'A vertical clip of iced coffee poured over a tall glass, condensation catching the light'
      },
      {
        title: 'Before and after',
        prompt: 'A tired desk becoming a tidy studio, soft morning light sweeping across it'
      },
      {
        title: 'Loopable background',
        prompt: 'A seamless loop of pastel ink drifting through water, calm and endless'
      }
    ]
  },
  {
    id: 'educational-content',
    label: 'Educational content',
    cards: [
      {
        title: 'Explain a process',
        prompt: 'A clean diagram of the water cycle drawn in soft gradients, each stage lighting up in turn'
      },
      {
        title: 'Classroom opener',
        prompt: 'A paper model of the solar system turning slowly above a wooden desk'
      },
      {
        title: 'Show a timeline',
        prompt: 'A gentle left to right timeline of a seed becoming a tree, one season per beat'
      }
    ]
  },
  {
    id: 'experimental-art',
    label: 'Experimental art',
    cards: [
      {
        title: 'Colour field study',
        prompt: 'Slow bands of violet and amber breathing against each other, grain and soft bloom'
      },
      {
        title: 'Shapes in motion',
        prompt: 'Thin geometric shapes drifting over a pale ground, shadows crossing like clock hands'
      },
      {
        title: 'Analogue texture',
        prompt: 'Light leaking across an old film frame, dust and halation, no subject at all'
      }
    ]
  },
  {
    id: 'other',
    label: 'Other',
    cards: [
      {
        title: 'Describe a place',
        prompt: 'A paper lantern rising over a quiet harbour at night'
      },
      {
        title: 'Start from a mood',
        prompt: 'A warm kitchen at the end of a long day, steam on the window, nobody in frame'
      },
      {
        title: 'Try a still frame',
        prompt: 'A ceramic mug on a linen table in soft morning light'
      }
    ]
  }
];
