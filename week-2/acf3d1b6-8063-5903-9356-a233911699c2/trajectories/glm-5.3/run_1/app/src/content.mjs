// Fixed content shipped with the app: plans, models, examples, templates and public page copy.

export const PLANS = [
  { id: 'free', name: 'Free', monthly_price: 0, yearly_price: 0, credits: 125, parallel_limit: 2, project_limit: 1,
    credits_line: '125 credits (one time)', description: "For people looking to explore Kinora's AI Tools", button: 'Start Free', yearly_note: 'Free forever.',
    tip: "125 one-time credits to explore Kinora's AI tools.", features: ["A selection of generative creative models to test concepts", 'Up to 1 project', '2 generations at a time'] },
  { id: 'standard', name: 'Standard', monthly_price: 1500, yearly_price: 1200, credits: 625, parallel_limit: 5, project_limit: 3,
    credits_line: '625 credits /mo', description: 'For curious creators trying AI video', button: 'Get Standard', yearly_note: 'Billed annually. Save $36/year.',
    tip: '625 credits monthly = 52s of Vela 4.5, 104s of Vela 4 Turbo, or 78 Vela Image 4 images.', features: ['Access to all Vela models', '5 generations at a time', 'Up to 3 projects', 'No watermarks'] },
  { id: 'pro', name: 'Pro', monthly_price: 3500, yearly_price: 2800, credits: 2250, parallel_limit: 15, project_limit: 5,
    credits_line: '2,250 credits /mo', description: 'For creators leveling up their craft', button: 'Get Pro', yearly_note: 'Billed annually. Save $84/year.', tab: 'Popular',
    tip: '2,250 credits monthly = 187s of Vela 4.5, 375s of Vela 4 Turbo, or 281 Vela Image 4 images.', features: ['Everything in Standard', '15 generations at a time', 'Up to 5 projects'] },
  { id: 'max', name: 'Max', monthly_price: 9500, yearly_price: 7600, credits: 9500, parallel_limit: 20, project_limit: 10,
    credits_line: '9,500 credits /mo', description: 'Best value for heavy solo usage', button: 'Get Max', yearly_note: 'Billed annually. Save $228/year.', tab: 'Best value', badge: 'Credits roll over 1 mo.',
    tip: '9,500 credits monthly = 791s of Vela 4.5, 1,583s of Vela 4 Turbo, or 1,187 Vela Image 4 images.', features: ['Early access to new models', '20 generations at a time', 'Up to 10 projects'] },
  { id: 'team', name: 'Team', monthly_price: 6900, yearly_price: 5500, credits: 6900, parallel_limit: 24, project_limit: 100, per_seat: true,
    credits_line: '6,900 credits per seat per month, pooled across the workspace', description: 'Best for fast-moving teams with high production needs', button: 'Get Team', yearly_note: 'billed yearly, 20% off',
    tip: 'Each seat adds 6,900 credits to one shared pool the moment it is added.', features: ['Everything in Max', 'Up to 100 shared projects', 'One shared credit pool', '24 parallel generations', 'Two to nine seats'] },
  { id: 'enterprise', name: 'Enterprise', monthly_price: null, yearly_price: null, credits: null, parallel_limit: null, project_limit: null,
    credits_line: 'Pricing and credits sized to your organization', description: 'Built for organizations: security, privacy, admin controls and SSO', button: 'Talk to Sales',
    tip: 'Credits and limits are sized to your organization with our sales team.', features: ['Everything in Team', 'Unlimited members and workspaces', 'Custom SSO, SOC 2 and ISO/IEC 27001, no training on your data'] },
];

export const MODELS = [
  { id: 'vela-4.5', name: 'Vela 4.5', kind: 'video', credits_per_unit: 12,
    blurb: 'Our most capable video model. Cinematic motion, consistent light and fine detail for shots that carry a whole film.' },
  { id: 'vela-4-turbo', name: 'Vela 4 Turbo', kind: 'video', credits_per_unit: 6,
    blurb: 'Fast, dependable video for iteration. Half the credits of Vela 4.5 with confident motion and clean composition.' },
  { id: 'vela-image-4', name: 'Vela Image 4', kind: 'image', credits_per_unit: 8,
    blurb: 'A still image model with a painterly eye for surface, light and arrangement, from product shots to concept art.' },
];

export const PLAN_LIMITS = { free: { credits: 125, parallel: 2, projects: 1 }, standard: { credits: 625, parallel: 5, projects: 3 }, pro: { credits: 2250, parallel: 15, projects: 5 }, max: { credits: 9500, parallel: 20, projects: 10 }, team: { credits: 6900, parallel: 24, projects: 100 } };

export function modelById(id) { return MODELS.find(m => m.id === id); }
export function planById(id) { return PLANS.find(p => p.id === id); }
export function generationCost(modelId, duration, imageCount) {
  const model = modelById(modelId);
  if (!model) return null;
  return model.kind === 'video' ? model.credits_per_unit * duration : model.credits_per_unit * imageCount;
}

export const EXAMPLES = [
  { heading: 'Product shot to finished commercial', category: 'product-ads',
    prompt: 'Make one complete stovetop coffee commercial for this kettle: onto the blue flame, water in, the steam curling up, then the pour and the cup in morning light. One kitchen, every shot in the same light.' },
  { heading: 'Five-shot brand film from one cup', category: 'product-ads',
    prompt: 'A five-shot sequence: a coffee cup on a sunlit caf\u00e9 table, small clouds rising from the steam and carrying the camera over misty hills of coffee plants, then back to the table.' },
  { heading: 'Product sheet to brand spot', category: 'product-ads',
    prompt: 'Make a thirty-second cereal ad from these three boxes: a child\u2019s imagination turns the cereal rings into giant hoops rolling across a beach at sunset, then back to the breakfast table.' },
  { heading: 'Animated story with consistent characters', category: 'animated-stories',
    prompt: 'Turn this tomato soldier into a twenty-second animated parody: he storms the beach with his vegetable squad to get the ketchup to the fries. Keep the characters consistent in every shot, no text on screen.' },
  { heading: 'Animated comedy scene', category: 'animated-stories',
    prompt: 'An undercover escape scene in a soft animated style: the chicken looks both ways, runs over to a sleeping dog, looks around, then taps him with its beak.' },
  { heading: 'UGC-style product video', category: 'ugc',
    prompt: 'Make a fifteen-second vertical ad for this chair: a guy films himself in his apartment, flops into it, hard cuts, handheld, real reactions.' },
  { heading: 'UGC demo video', category: 'ugc',
    prompt: 'Make a fifteen-second clip for this hose-end lawn sprayer: a person filming himself in his own front yard at golden hour, hooking it up, spraying the lawn and talking to camera.' },
  { heading: 'Product page to cinematic spot', category: 'from-a-link',
    prompt: 'Make a fifteen-second cinematic commercial from this product page for a running shoe: macro details, a slow orbit, dramatic red and black lighting, ending on the full silhouette.' },
];

export const EXAMPLE_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'product-ads', label: 'Product ads' },
  { id: 'animated-stories', label: 'Animated stories' },
  { id: 'ugc', label: 'UGC' },
  { id: 'from-a-link', label: 'From a link' },
];

export const TEMPLATES = [
  { tab: 'marketing', label: 'Marketing campaigns', cards: [
    { title: 'Make video ad for socials', prompt: 'A fifteen second vertical ad for a reusable water bottle: a cyclist pauses at golden hour, drinks, and rides on' },
    { title: 'Reshoot your product', prompt: 'A glass perfume bottle on wet black stone, slow orbit, soft rim light' },
    { title: 'Build creative from a brief', prompt: 'A cosy autumn launch film for a knitwear label: a cabin porch, falling leaves, warm window light' },
    { title: 'Generate A/B variants', prompt: 'A sneaker on a concrete plinth, first in hard noon light, then in soft overcast light' },
    { title: 'Create seasonal campaign', prompt: 'A winter window display for a bookshop, snow drifting past warm lamplight' },
  ]},
  { tab: 'movies', label: 'Movies', cards: [
    { title: 'Opening scene', prompt: 'A lone lighthouse keeper climbs the spiral stairs at dusk, storm light flickering through the glass' },
    { title: 'Dream sequence', prompt: 'A paper lantern rising over a quiet harbour at night, reflections rippling in black water' },
    { title: 'Title card backdrop', prompt: 'Slow drifting fog over an empty city intersection at dawn, traffic lights blinking' },
  ]},
  { tab: 'social', label: 'Social media', cards: [
    { title: 'Looping product moment', prompt: 'A citrus wedge falling into sparkling water, shot from below, catching the light' },
    { title: 'Behind the scenes', prompt: 'An artist\u2019s hands mixing deep blue paint in a studio, warm lamp, close camera' },
  ]},
  { tab: 'education', label: 'Educational content', cards: [
    { title: 'Explain a process', prompt: 'A clean animated explainer of the water cycle, soft flat colours, gentle camera moves' },
    { title: 'Historical scene', prompt: 'A printing press workshop in the 1600s, ink, paper, morning light through high windows' },
  ]},
  { tab: 'experimental', label: 'Experimental art', cards: [
    { title: 'Abstract drift', prompt: 'Soft bands of indigo and amber folding into each other, slow and weightless' },
    { title: 'Light study', prompt: 'Hard shadows of window frames moving across a white wall over one whole day' },
  ]},
  { tab: 'other', label: 'Other', cards: [
    { title: 'Slow reveal', prompt: 'A match struck in a dark room, smoke curling upward in a single beam of light' },
    { title: 'Place study', prompt: 'An empty tram at night sliding past lit shopfronts, rain on the windows' },
  ]},
];

export const COMPANY_SIZES = ['1-200', '201-1,000', '1,001-5,000', '5,001-10,000', '10,001+'];
export const INDUSTRIES = ['Architecture & Real Estate', 'Automotive', 'Creative Agency', 'Financial Services', 'Gaming', 'Healthcare', 'Media & Entertainment', 'Professional Services', 'Consumer Goods & Retail', 'Software & Telecom', 'Travel & Hospitality', 'Other'];
export const ENQUIRY_PRODUCTS = [
  { id: 'creative-platform', label: 'Creative Platform' },
  { id: 'api', label: 'API' },
  { id: 'model-weights-licensing', label: 'Model Weights Licensing', tip: "License Kinora's underlying AI model weights for your bespoke requirements. Custom pricing." },
  { id: 'kinora-ads', label: 'Kinora Ads' },
];

export const PRODUCT_TOOLS = [
  { name: 'Transform Video', desc: 'Restyle any shot in a single prompt. Keep the motion, replace the mood, the palette or the whole world around it.' },
  { name: 'Mood Boards', desc: 'Turn a handful of references into a board of drawn frames that share one light, one palette and one attitude.' },
  { name: 'Virtual Staging', desc: 'Furnish an empty room with any style and any era, and walk the camera through it.' },
  { name: 'Character Performance', desc: 'Give a character a performance: expression, timing and intent, driven by a line or a reference.' },
  { name: 'Virtual Try-On', desc: 'See garments on a drawn figure that moves the way you ask, from any angle you need.' },
  { name: 'Design Explorations', desc: 'Explore packaging, posters and product directions as fast as you can describe them.' },
  { name: 'Storyboarding', desc: 'Break a script into boards with consistent characters and continuity between frames.' },
  { name: 'Animatics', desc: 'Give your boards motion and timing to feel the cut before you commit to it.' },
  { name: 'Generate Yourself', desc: 'Place yourself in any scene, in any style, holding any pose you can describe.' },
  { name: 'Visual Effects', desc: 'Add weather, fire, light and impossible physics to real footage with a prompt.' },
];

export const PRODUCT_APPS = [
  { name: 'Remove from Video', desc: 'Remove anything from any video with a simple prompt.' },
  { name: 'Reshoot Product', desc: 'Reshoot any product in new light, new sets, new seasons.' },
  { name: 'Upscale Video', desc: 'Lift older footage to clean, sharp, modern resolution.' },
  { name: 'Add Dialogue', desc: 'Give your characters a voice with matching mouth movement.' },
  { name: 'Change Image Style', desc: 'Move any image into a new style while keeping its subject.' },
  { name: 'Add Performance', desc: 'Animate a still person into a moving, expressive performance.' },
  { name: 'Change Backdrop', desc: 'Swap the world behind your subject in one prompt.' },
  { name: 'Change Time of Day', desc: 'Move any shot to dawn, dusk, midnight or high noon.' },
  { name: 'Relight Scene', desc: 'Re-light a whole scene as if the sun had moved.' },
];

export const USE_CASES = [
  { name: 'Social Media Content Creation', line: 'Make scroll-stopping clips in vertical shapes, cut for pacing and ready to post.' },
  { name: 'Product shots', line: 'Clean, well-lit product films from a single reference, on any set you can describe.' },
  { name: 'Packaging & Retail Visualization', line: 'See packaging on shelves and in hands before anything is printed.' },
  { name: 'Automotive Product Photography', line: 'Orbits, rolling shots and studio light for cars, without the studio.' },
  { name: 'UGC ads', line: 'Authentic-feeling creator ads with real reactions and handheld energy.' },
];

export const HOME_TABS = [
  { label: 'How Kinora is Used', desc: 'Teams turn one idea into finished media, in minutes rather than weeks, by generating straight into the formats they publish in.', prompt: 'A product film for a ceramic mug, morning light, slow orbit' },
  { label: 'Create with Agent', desc: 'Describe a goal and an agent plans the shots, generates them and keeps the look consistent across the whole piece.', prompt: 'A five-shot launch film for a ceramic mug, one kitchen, one light' },
  { label: 'Build your own Workflows', desc: 'Chain models and tools into a repeatable pipeline your whole team can run again and again.', prompt: 'A storyboard of six frames for a winter caf\u00e9 launch, consistent characters' },
  { label: 'Enterprise-grade', desc: 'Permissions, shared credit pools and audit trails that let large teams move fast without losing control.', prompt: 'A brand-safe product film, locked palette, no text on screen' },
  { label: 'The World\u2019s Best Models', desc: 'Vela 4.5 and its family hold motion, palette and detail together, shot after shot.', prompt: 'A cinematic shot of rain on neon signs, slow camera push' },
];

export const HOME_NEWS = [
  { title: 'Vela 4.5 is now generally available', summary: 'Our most capable video model ships to every paid plan, with finer light and steadier motion.' },
  { title: 'Shared credit pools for teams', summary: 'Team workspaces now spend from one balance, with per-seat credits that land the moment a seat is added.' },
  { title: 'Workflows: reusable creative pipelines', summary: 'Chain models and tools into templates your team can run on demand.' },
  { title: 'Kinora Creative in the studio', summary: 'A look at how three studios built their spring campaigns entirely inside Kinora.' },
];

export const TEAM_FAQS = [
  { q: 'What is the Team plan?', a: 'Team is a plan for groups of two to nine people who create together in one Kinora workspace.' },
  { q: 'How does the shared credit pool work?', a: 'Every seat adds 6,900 credits a month to a single shared pool, and they land the moment you add the seat. Everyone in the workspace spends from that one balance.' },
  { q: 'Can I change the number of seats?', a: 'You can add seats up to nine at any time, and each new seat adds its credits to the pool right away. Removing a member does not take their credits back.' },
  { q: 'When should we consider Enterprise instead?', a: 'If you need more than nine seats, custom security reviews, SSO or unlimited workspaces, talk to our sales team about Enterprise.' },
];

export const RESEARCH_PAPERS = [
  { title: 'Vela 4.5: Consistent Cinematic Video Generation', authors: 'Mara Quinn, Ines Duarte, and the Kinora team', date: 'September 2026',
    abstract: 'We present Vela 4.5, a video model that holds light, palette and subject identity stable across long multi-shot sequences, and describe the training and evaluation choices behind it.' },
  { title: 'General World Models for Embodied Simulation', authors: 'Theo Park, Jo Ellis and the Kinora research group', date: 'July 2026',
    abstract: 'A study of world models that predict how scenes evolve under action, and how they can be used to plan and rehearse physical outcomes before they happen.' },
  { title: 'Real-World Intelligence: Acting in Open Environments', authors: 'The Kinora research group', date: 'March 2026',
    abstract: 'We define Real-World Intelligence as the ability to understand, simulate and act in open worlds, and chart the path from generative models to agents that act safely in open environments.' },
];

export const RESOURCES_FEATURED = [
  { title: 'Getting started with the studio', author: 'Kinora team', date: 'October 2026', summary: 'A tour of the composer, projects and the credit balance.' },
  { title: 'Prompting for cinematic light', author: 'Ines Duarte', date: 'October 2026', summary: 'How small words about light change everything about a shot.' },
  { title: 'Planning a campaign in credits', author: 'Mara Quinn', date: 'September 2026', summary: 'Budgeting a whole launch across the models in the catalogue.' },
];

export const RESOURCES_ALL = [
  { title: 'Understanding credits and costs', author: 'Kinora team', date: '18 October 2026' },
  { title: 'Vertical video that holds attention', author: 'Theo Park', date: '2 October 2026' },
  { title: 'From storyboard to animatic in one afternoon', author: 'Jo Ellis', date: '24 September 2026' },
  { title: 'Shared pools: how teams spend together', author: 'Mara Quinn', date: '9 September 2026' },
  { title: 'A field guide to aspect ratios', author: 'Ines Duarte', date: '30 August 2026' },
];

export const PARTNERS = ['Northwind Labs', 'Vertex Motion', 'Harbourline', 'Studio Meridian', 'Paper & Field', 'Lumen Works', 'Atlas Pictures', 'Quietmachinery'];

export const ENTERPRISE_STATS = [
  { stat: '2 weeks', note: 'Saved on production timeline despite no access to on-camera talent', company: 'Pellworth & Sons' },
  { stat: '80%', note: 'Cost savings vs traditional VFX Pipeline', company: 'Grovemont Media' },
];

export const ENTERPRISE_POINTS = ['We don\u2019t train on your data', 'SOC 2 Type 2', 'Customizable access & permissions', 'Full ownership of your outputs', 'Single Sign On (SSO)'];

export const LICENSING_CARDS = [
  { title: 'Start at the frontier.', desc: 'License the same Vela weights that power Kinora Creative, with a research or commercial licence to fit your build.' },
  { title: 'Tune it to you.', desc: 'Fine-tune on your own data, on your own infrastructure, with your own checkpoints and evals.' },
  { title: 'Run within your walls.', desc: 'Self-host on the hardware you already run, air-gapped if you need it, with no call home.' },
  { title: 'White glove service.', desc: 'A dedicated engineer helps you integrate, evaluate and ship, from first call to production.' },
];

export const WORKFLOW_REASONS = ['Combine multiple models, modalities and tasks', 'Create reusable templates', 'Automate repetitive tasks'];
export const FEATURED_WORKFLOWS = ['Image Style Generator', 'Image Variations', 'Storyboard Creator', 'Virtual Try On', 'Custom Instructions Workshop', 'Image to Text', 'Hair Salon', 'Animatic Generator', 'Style Blend'];

export const ANNOUNCEMENT = 'Enterprises get 2 months of usage free. Sign by 10/31.';
export const FOOTER_NOTE = '\u00a92026 Kinora AI, Inc.';

export const SEAT_CREDITS = 6900;
export const SEAT_LIMIT = 9;

// Public route metadata used for page titles and the static prerender list.
export const PUBLIC_ROUTES = [
  { path: '/', title: 'Kinora \u2014 Building Real-World Intelligence' },
  { path: '/product', title: 'A new frontier for video generation \u2014 Kinora' },
  { path: '/pricing', title: 'Choose the Right Plan for You \u2014 Kinora' },
  { path: '/team-plan', title: 'Kinora Team \u2014 Kinora' },
  { path: '/enterprise', title: 'Production-ready AI, Made for Enterprise \u2014 Kinora' },
  { path: '/enterprise-contact', title: 'Contact Enterprise Sales \u2014 Kinora' },
  { path: '/model-licensing', title: 'Model licensing \u2014 Kinora' },
  { path: '/examples', title: 'Explore all examples \u2014 Kinora' },
  { path: '/use-cases', title: 'AI video for whatever you make \u2014 Kinora' },
  { path: '/workflows', title: 'Introducing Kinora Workflows \u2014 Kinora' },
  { path: '/research', title: 'Kinora Research' },
  { path: '/resources', title: 'Kinora Resources' },
  { path: '/privacy', title: 'Privacy Policy \u2014 Kinora' },
  { path: '/signup', title: 'Create your account \u2014 Kinora' },
  { path: '/login', title: 'Welcome to Kinora' },
  { path: '/invite', title: 'Join a team on Kinora' },
  { path: '/studio', title: 'Kinora Studio' },
  { path: '/not-found', title: 'Page not found \u2014 Kinora' },
];
