import type {
  ContentRecord,
  Interview,
  Product,
  Scenario,
  SiteCopy,
} from '../shared/types';

const SEED_SITE_COPY: SiteCopy = {
  opening: {
    heading: 'Energy you make, at your own pace.',
    line: 'Vireo Pace is a daily drink stick from Alder Quay Laboratories, made with red beet root.',
  },
  about: {
    heading: 'Inner Pace',
    lead: 'Inner Pace is how Alder Quay Laboratories thinks about energy: something your body already makes, spends in effort and rebuilds in recovery.',
    panels: [
      {
        title: 'Effort',
        text: 'Every climb, deadline and load of laundry spends energy your body makes from breath and food.',
      },
      {
        title: 'Recovery',
        text: 'Pauses, meals and sleep are when the body rebuilds what effort used.',
      },
      {
        title: 'One pace',
        text: 'Effort and recovery are not opposites. Kept in rhythm they are one pace: your Inner Pace.',
      },
    ],
  },
  oxygen: {
    heading: 'From breath to energy',
    stages: [
      {
        name: 'Breath',
        title: 'Air reaches the lungs',
        text: 'With each breath, air travels down to hundreds of millions of tiny air sacs in the lungs, where oxygen passes into the blood.',
      },
      {
        name: 'Blood',
        title: 'Red blood cells carry it',
        text: 'Haemoglobin inside red blood cells picks up oxygen in the lungs and carries it through the arteries to every tissue.',
      },
      {
        name: 'Cell',
        title: 'Oxygen enters the cell',
        text: 'In the smallest blood vessels, oxygen leaves the blood and moves into the cells that use it.',
      },
      {
        name: 'Mitochondria',
        title: 'Mitochondria use it',
        text: 'Inside each cell, mitochondria use oxygen to release the energy stored in food, giving off water and carbon dioxide.',
      },
      {
        name: 'ATP',
        title: 'Energy you can spend',
        text: 'That energy is held in a molecule called ATP, which muscles and nerves spend as you move, think and rest.',
      },
    ],
  },
  science: {
    heading: 'A root that keeps nitrate',
    lead: 'Vireo Pace is made with red beet root. Here is what that plant is, what it holds and how it becomes a powder.',
    disclosures: [
      {
        title: 'Where it grows',
        text: 'Red beet (Beta vulgaris) is a root vegetable grown in cool climates. Its deep red colour comes from pigments called betalains.',
      },
      {
        title: 'What it holds',
        text: 'Beet roots store nitrate taken up from the soil, along with natural sugars and fibre.',
      },
      {
        title: 'How it becomes powder',
        text: 'Washed roots are sliced, juiced, gently dried and milled into a fine powder.',
      },
    ],
    steps: [
      {
        name: 'Nitrate',
        text: 'Beet roots store nitrate taken up from the soil.',
      },
      {
        name: 'Nitrite',
        text: 'Bacteria in the mouth turn part of swallowed nitrate into nitrite.',
      },
      {
        name: 'Nitric oxide',
        text: 'In the body, part of that nitrite becomes nitric oxide, a molecule involved in widening blood vessels.',
      },
    ],
  },
  interviews: {
    heading: 'Voices on pace',
    note: 'Everyone in these interviews is fictional. They talk about their own routines, not about results from Vireo Pace.',
  },
  lifestyle: {
    heading: 'ON and OFF, one pace',
    lead: 'Some moments call for effort, others for recovery. Choose a mode, then a moment.',
  },
  footer: {
    name: 'Alder Quay Laboratories',
    line: 'A fictional company created for this site.',
    copyright: '© 2026 Alder Quay Laboratories',
  },
  contact: {
    heading: 'Contact',
    care: 'Alder Quay Customer Care',
    phone: 'Phone 0120-555-014, weekdays 9:00 to 17:00',
    email: 'care@alderquay.example',
  },
  privacy: {
    heading: 'Privacy',
    body: 'This site sets no cookies and keeps no record of who you are. Server logs keep the address and time of each request for 14 days.',
  },
  legal: {
    heading: 'Legal',
    body: 'Alder Quay Laboratories, Vireo Pace and every person on this site are fictional. All text and pictures were made for this site.',
  },
};

const SEED_PRODUCT: Product = {
  name: 'Vireo Pace',
  format: 'Drink stick, 6 g of powder',
  serving: 'One stick in 150 ml of water',
  packs: [
    { sticks: 14, price_yen: 1980 },
    { sticks: 30, price_yen: 3960 },
  ],
  ingredients: [
    { name: 'Red beet root powder', mg: 3000 },
    { name: 'Dextrin', mg: 2400 },
    { name: 'Yuzu juice powder', mg: 450 },
    { name: 'Sea salt', mg: 100 },
    { name: 'Vitamin C', mg: 50 },
  ],
  how_to_use: [
    'Tear open one stick.',
    'Stir it into 150 ml of cold or room-temperature water.',
    'Drink it within 30 minutes of mixing.',
  ],
  storage: 'Keep sealed sticks away from direct sunlight, heat and damp.',
  cautions: [
    'If you are pregnant, nursing, taking medication or under medical care, ask your doctor before use.',
    'Red beet can turn urine pink or red.',
  ],
  stores: [
    {
      name: 'Alder Quay Online Store',
      url: 'https://store.alderquay.example/vireo-pace',
    },
    {
      name: 'Harbourline Pharmacy Online',
      url: 'https://harbourline.example/vireo-pace',
    },
  ],
};

const SEED_INTERVIEWS: Interview[] = [
  {
    slug: 'mina-okabe',
    name: 'Mina Okabe',
    role: 'Sports physiologist',
    category: 'expert',
    lede: 'Hard days only count if easy days follow them.',
    hue: 150,
    answers: [
      {
        question: 'What do people get wrong about training?',
        answer:
          'They count the hard sessions and forget the easy ones. The body adapts during recovery, so the easy days are part of the work.',
      },
      {
        question: 'How do you spend your own rest days?',
        answer:
          'A long walk, a proper lunch and an early night. Nothing I would post about.',
      },
    ],
  },
  {
    slug: 'daniel-reyes',
    name: 'Daniel Reyes',
    role: 'Sleep researcher',
    category: 'expert',
    lede: 'Sleep is the longest recovery of the day.',
    hue: 220,
    answers: [
      {
        question: 'Why is sleep harder to protect than exercise?',
        answer:
          'Nobody hands you a medal for going to bed on time. It is still the habit I would keep if I could keep only one.',
      },
      {
        question: 'What is your evening routine?',
        answer:
          'Screens off at ten, the same book for twenty minutes, lights out by half past.',
      },
    ],
  },
  {
    slug: 'harue-sato',
    name: 'Harue Sato',
    role: 'Registered dietitian',
    category: 'expert',
    lede: 'Regular meals make a steadier day than perfect ones.',
    hue: 35,
    answers: [
      {
        question:
          'Where do you start with someone who feels flat every afternoon?',
        answer:
          'With lunch. Many people skip it or eat it standing up, then wonder why the middle of the afternoon feels long.',
      },
      {
        question: 'Do you plan your own meals?',
        answer:
          'Loosely. I cook twice a week and eat the leftovers without guilt.',
      },
    ],
  },
  {
    slug: 'kenji-mori',
    name: 'Kenji Mori',
    role: 'Carpenter and trail runner',
    category: 'everyday',
    lede: 'I run before work so the workshop gets my calm hours.',
    hue: 95,
    answers: [
      {
        question: 'When do you run?',
        answer:
          'At six, three mornings a week, on the forest trail behind the workshop.',
      },
      {
        question: 'What does a rest day look like?',
        answer: 'Sharpening tools, a nap after lunch and no stopwatch anywhere.',
      },
    ],
  },
  {
    slug: 'ana-lindqvist',
    name: 'Ana Lindqvist',
    role: 'Night-shift nurse',
    category: 'everyday',
    lede: 'My week has two clocks, and I keep both honest.',
    hue: 265,
    answers: [
      {
        question: 'How do you switch between night and day weeks?',
        answer:
          'Slowly. I move bedtime by an hour a day and keep the curtains shut until it sticks.',
      },
      {
        question: 'What helps you wind down after a shift?',
        answer: 'A shower, a short walk with the dog and then straight to bed.',
      },
    ],
  },
  {
    slug: 'tom-achebe',
    name: 'Tom Achebe',
    role: 'Designer working from home',
    category: 'everyday',
    lede: 'The commute I lost became a walk I keep.',
    hue: 5,
    answers: [
      {
        question: 'What changed when you started working from home?',
        answer:
          'The day lost its edges. I added a walk at nine and at five so it has a start and an end again.',
      },
      {
        question: 'How do you share housework with two children at home?',
        answer:
          'A chart on the fridge and a ten-minute tidy before dinner that everyone joins.',
      },
    ],
  },
];

const SEED_SCENARIOS: Scenario[] = [
  {
    id: 'on-work',
    mode: 'on',
    name: 'Work',
    title: 'The long afternoon',
    time: '15:00',
    copy: 'Meetings run into each other and the window light starts to slant.',
    moment: 'A glass of water with a stick of Vireo Pace beside the keyboard.',
  },
  {
    id: 'on-sports',
    mode: 'on',
    name: 'Sports',
    title: 'Before the climb',
    time: '07:30',
    copy: 'Laces tied, the trail head still in shade.',
    moment: 'A bottle mixed the night before, cold from the fridge.',
  },
  {
    id: 'on-hobby',
    mode: 'on',
    name: 'Hobby',
    title: 'The workbench',
    time: '10:00',
    copy: 'Saturday hands on wood, glue and the radio.',
    moment: 'A cup on the shelf, away from the sawdust.',
  },
  {
    id: 'on-housework',
    mode: 'on',
    name: 'Housework',
    title: 'Laundry day',
    time: '11:30',
    copy: 'Two loads hung, one to fold, floors next.',
    moment: 'A glass on the windowsill between rooms.',
  },
  {
    id: 'off-break',
    mode: 'off',
    name: 'Break',
    title: 'Ten minutes',
    time: '13:10',
    copy: 'Phone face down, shoulders down.',
    moment: 'Water, a window, nothing to finish.',
  },
  {
    id: 'off-holiday',
    mode: 'off',
    name: 'Holiday',
    title: 'Slow morning',
    time: '09:00',
    copy: 'No alarm, a guidebook left closed.',
    moment: 'A stick packed in the day bag, just in case.',
  },
  {
    id: 'off-relax',
    mode: 'off',
    name: 'Relax',
    title: 'After the bath',
    time: '21:00',
    copy: 'Steam on the mirror, music low.',
    moment: 'Warm tea instead; the stick can wait for tomorrow.',
  },
  {
    id: 'off-rest',
    mode: 'off',
    name: 'Rest',
    title: 'Lights out',
    time: '23:00',
    copy: 'The day put away, the room dark and cool.',
    moment: 'Nothing at all. Rest is part of the pace.',
  },
];

export const SEED_EDITION = 1;

export function seedContentRecord(): ContentRecord {
  return structuredClone({
    edition: SEED_EDITION,
    product: SEED_PRODUCT,
    interviews: SEED_INTERVIEWS,
    scenarios: SEED_SCENARIOS,
    site: SEED_SITE_COPY,
  });
}
