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
