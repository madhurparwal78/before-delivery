import type { ContentRecord } from "../shared/content.js";

/** The starting content of edition 1. It lives only on the server and fills an empty database. */
export const STARTING_CONTENT: ContentRecord = {
  product: {
    name: "Vireo Pace",
    format: "Drink stick, 6 g of powder",
    serving: "One stick in 150 ml of water",
    packs: [
      { sticks: 14, price_yen: 1980 },
      { sticks: 30, price_yen: 3960 },
    ],
    ingredients: [
      { name: "Red beet root powder", mg: 3000 },
      { name: "Dextrin", mg: 2400 },
      { name: "Yuzu juice powder", mg: 450 },
      { name: "Sea salt", mg: 100 },
      { name: "Vitamin C", mg: 50 },
    ],
    how_to_use: [
      "Tear open one stick.",
      "Stir it into 150 ml of cold or room-temperature water.",
      "Drink it within 30 minutes of mixing.",
    ],
    storage: "Keep sealed sticks away from direct sunlight, heat and damp.",
    cautions: [
      "If you are pregnant, nursing, taking medication or under medical care, ask your doctor before use.",
      "Red beet can turn urine pink or red.",
    ],
    stores: [
      { name: "Alder Quay Online Store", url: "https://store.alderquay.example/vireo-pace" },
      { name: "Harbourline Pharmacy Online", url: "https://harbourline.example/vireo-pace" },
    ],
  },
  interviews: [
    {
      slug: "mina-okabe", name: "Mina Okabe", role: "Sports physiologist", category: "expert", hue: 150,
      lede: "Hard days only count if easy days follow them.",
      answers: [
        { question: "What do people get wrong about training?", answer: "They count the hard sessions and forget the easy ones. The body adapts during recovery, so the easy days are part of the work." },
        { question: "How do you spend your own rest days?", answer: "A long walk, a proper lunch and an early night. Nothing I would post about." },
      ],
    },
    {
      slug: "daniel-reyes", name: "Daniel Reyes", role: "Sleep researcher", category: "expert", hue: 220,
      lede: "Sleep is the longest recovery of the day.",
      answers: [
        { question: "Why is sleep harder to protect than exercise?", answer: "Nobody hands you a medal for going to bed on time. It is still the habit I would keep if I could keep only one." },
        { question: "What is your evening routine?", answer: "Screens off at ten, the same book for twenty minutes, lights out by half past." },
      ],
    },
    {
      slug: "harue-sato", name: "Harue Sato", role: "Registered dietitian", category: "expert", hue: 35,
      lede: "Regular meals make a steadier day than perfect ones.",
      answers: [
        { question: "Where do you start with someone who feels flat every afternoon?", answer: "With lunch. Many people skip it or eat it standing up, then wonder why the middle of the afternoon feels long." },
        { question: "Do you plan your own meals?", answer: "Loosely. I cook twice a week and eat the leftovers without guilt." },
      ],
    },
    {
      slug: "kenji-mori", name: "Kenji Mori", role: "Carpenter and trail runner", category: "everyday", hue: 95,
      lede: "I run before work so the workshop gets my calm hours.",
      answers: [
        { question: "When do you run?", answer: "At six, three mornings a week, on the forest trail behind the workshop." },
        { question: "What does a rest day look like?", answer: "Sharpening tools, a nap after lunch and no stopwatch anywhere." },
      ],
    },
    {
      slug: "ana-lindqvist", name: "Ana Lindqvist", role: "Night-shift nurse", category: "everyday", hue: 265,
      lede: "My week has two clocks, and I keep both honest.",
      answers: [
        { question: "How do you switch between night and day weeks?", answer: "Slowly. I move bedtime by an hour a day and keep the curtains shut until it sticks." },
        { question: "What helps you wind down after a shift?", answer: "A shower, a short walk with the dog and then straight to bed." },
      ],
    },
    {
      slug: "tom-achebe", name: "Tom Achebe", role: "Designer working from home", category: "everyday", hue: 5,
      lede: "The commute I lost became a walk I keep.",
      answers: [
        { question: "What changed when you started working from home?", answer: "The day lost its edges. I added a walk at nine and at five so it has a start and an end again." },
        { question: "How do you share housework with two children at home?", answer: "A chart on the fridge and a ten-minute tidy before dinner that everyone joins." },
      ],
    },
  ],
  scenarios: [
    { id: "on-work", mode: "on", name: "Work", title: "The long afternoon", time: "15:00", copy: "Meetings run into each other and the window light starts to slant.", moment: "A glass of water with a stick of Vireo Pace beside the keyboard." },
    { id: "on-sports", mode: "on", name: "Sports", title: "Before the climb", time: "07:30", copy: "Laces tied, the trail head still in shade.", moment: "A bottle mixed the night before, cold from the fridge." },
    { id: "on-hobby", mode: "on", name: "Hobby", title: "The workbench", time: "10:00", copy: "Saturday hands on wood, glue and the radio.", moment: "A cup on the shelf, away from the sawdust." },
    { id: "on-housework", mode: "on", name: "Housework", title: "Laundry day", time: "11:30", copy: "Two loads hung, one to fold, floors next.", moment: "A glass on the windowsill between rooms." },
    { id: "off-break", mode: "off", name: "Break", title: "Ten minutes", time: "13:10", copy: "Phone face down, shoulders down.", moment: "Water, a window, nothing to finish." },
    { id: "off-holiday", mode: "off", name: "Holiday", title: "Slow morning", time: "09:00", copy: "No alarm, a guidebook left closed.", moment: "A stick packed in the day bag, just in case." },
    { id: "off-relax", mode: "off", name: "Relax", title: "After the bath", time: "21:00", copy: "Steam on the mirror, music low.", moment: "Warm tea instead; the stick can wait for tomorrow." },
    { id: "off-rest", mode: "off", name: "Rest", title: "Lights out", time: "23:00", copy: "The day put away, the room dark and cool.", moment: "Nothing at all. Rest is part of the pace." },
  ],
};
