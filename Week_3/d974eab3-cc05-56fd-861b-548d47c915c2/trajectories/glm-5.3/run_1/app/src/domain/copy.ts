export interface StageCopy {
  name: string;
  title: string;
  text: string;
}

export const OXYGEN_STAGES: StageCopy[] = [
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
];

export interface PanelCopy {
  title: string;
  text: string;
}

export const INNER_PACE_PANELS: PanelCopy[] = [
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
];

export interface DisclosureCopy {
  name: string;
  text: string;
}

export const SCIENCE_DISCLOSURES: DisclosureCopy[] = [
  {
    name: 'Where it grows',
    text: 'Red beet (Beta vulgaris) is a root vegetable grown in cool climates. Its deep red colour comes from pigments called betalains.',
  },
  {
    name: 'What it holds',
    text: 'Beet roots store nitrate taken up from the soil, along with natural sugars and fibre.',
  },
  {
    name: 'How it becomes powder',
    text: 'Washed roots are sliced, juiced, gently dried and milled into a fine powder.',
  },
];

export interface PathwayStep {
  name: string;
  text: string;
}

export const NITRATE_STEPS: PathwayStep[] = [
  { name: 'Nitrate', text: 'Beet roots store nitrate taken up from the soil.' },
  { name: 'Nitrite', text: 'Bacteria in the mouth turn part of swallowed nitrate into nitrite.' },
  {
    name: 'Nitric oxide',
    text: 'In the body, part of that nitrite becomes nitric oxide, a molecule involved in widening blood vessels.',
  },
];

export const SITE_COPY = {
  opening: {
    heading: 'Energy you make, at your own pace.',
    line: 'Vireo Pace is a daily drink stick from Alder Quay Laboratories, made with red beet root.',
  },
  about: {
    heading: 'Inner Pace',
    lead: 'Inner Pace is how Alder Quay Laboratories thinks about energy: something your body already makes, spends in effort and rebuilds in recovery.',
  },
  oxygen: {
    heading: 'From breath to energy',
  },
  science: {
    heading: 'A root that keeps nitrate',
    lead: 'Vireo Pace is made with red beet root. Here is what that plant is, what it holds and how it becomes a powder.',
  },
  interviews: {
    heading: 'Voices on pace',
    fictionalNote:
      'Everyone in these interviews is fictional. They talk about their own routines, not about results from Vireo Pace.',
  },
  lifestyle: {
    heading: 'ON and OFF, one pace',
    lead: 'Some moments call for effort, others for recovery. Choose a mode, then a moment.',
  },
  footer: {
    company: 'Alder Quay Laboratories',
    fictional: 'A fictional company created for this site.',
    copyright: '© 2026 Alder Quay Laboratories',
  },
  contact: {
    heading: 'Contact',
    lines: ['Alder Quay Customer Care', 'Phone 0120-555-014, weekdays 9:00 to 17:00'],
    email: 'care@alderquay.example',
  },
  privacy: {
    heading: 'Privacy',
    text: 'This site sets no cookies and keeps no record of who you are. Server logs keep the address and time of each request for 14 days.',
  },
  legal: {
    heading: 'Legal',
    text: 'Alder Quay Laboratories, Vireo Pace and every person on this site are fictional. All text and pictures were made for this site.',
  },
} as const;
