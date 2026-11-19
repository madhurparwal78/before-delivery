import type { Axis, Currency, Phase } from '../shared/types.js';

export interface StepSpec {
  key: string;
  title: string;
  phase: Phase;
  explode: number;
  /** Focus parts named by node path, so duplicate names stay distinct. */
  focus: string[];
  yaw: number;
  pitch: number;
  text: string;
}

export interface PartPricing {
  unitPrice: number;
  quantity: number;
  fittedAtKey: string | null;
}

export interface VersionSpec {
  stepKeys: string[];
  stepTextOverrides?: Record<string, string>;
  pricing: Record<string, PartPricing>;
}

export interface GuideSpec {
  sample: string;
  currency: Currency;
  axis: Axis;
  tags: string[];
  apartMm: Record<string, number>;
  steps: Record<string, StepSpec>;
  versions: VersionSpec[];
}

const GRINDER_PARTS = {
  housing: 'Housing[0]',
  hopper: 'Housing[0]/Hopper[0]',
  chute: 'Housing[0]/Bean chute[0]',
  upperBurr: 'Housing[0]/Upper burr[0]',
  motor: 'Housing[0]/Motor[0]',
  shaft: 'Housing[0]/Drive shaft[0]',
  lowerBurr: 'Housing[0]/Drive shaft[0]/Lower burr[0]',
  basePlate: 'Base plate[0]',
  groundsTray: 'Grounds tray[0]',
} as const;

const GRINDER_STEPS: Record<string, StepSpec> = {
  unplug: {
    key: 'unplug',
    title: 'Unplug and empty the grinder',
    phase: 'open_up',
    explode: 0,
    focus: [GRINDER_PARTS.hopper],
    yaw: 30,
    pitch: 15,
    text: 'Unplug the grinder and tip out any beans.',
  },
  hopper: {
    key: 'hopper',
    title: 'Lift off the hopper',
    phase: 'open_up',
    explode: 0,
    focus: [GRINDER_PARTS.hopper],
    yaw: 30,
    pitch: 15,
    text: 'Unplug the grinder, then turn the hopper a quarter turn and lift it straight up.',
  },
  upper: {
    key: 'upper',
    title: 'Free the upper burr',
    phase: 'take_out',
    explode: 0.25,
    focus: [GRINDER_PARTS.upperBurr],
    yaw: 45,
    pitch: 20,
    text: 'Undo the two clips and lift the upper burr out by its handle.',
  },
  lower: {
    key: 'lower',
    title: 'Draw out the lower burr',
    phase: 'take_out',
    explode: 0.5,
    focus: [GRINDER_PARTS.lowerBurr, GRINDER_PARTS.shaft],
    yaw: 60,
    pitch: 10,
    text: 'Pull the lower burr straight up off the drive shaft without twisting it.',
  },
  fitnew: {
    key: 'fitnew',
    title: 'Fit the new burr set',
    phase: 'fit_new',
    explode: 0.85,
    focus: [GRINDER_PARTS.upperBurr, GRINDER_PARTS.lowerBurr],
    yaw: 60,
    pitch: 25,
    text: 'Seat the new burrs and turn them a quarter turn until they click.',
  },
  closeup: {
    key: 'closeup',
    title: 'Refit the chute and close up',
    phase: 'close_up',
    explode: 0,
    focus: [GRINDER_PARTS.chute],
    yaw: 30,
    pitch: 15,
    text: 'Press the new chute home, then refit the hopper and run a few beans through.',
  },
};

const GRINDER_EARLIER_TEXT = 'Seat the new burrs and turn them a quarter turn by hand.';

export const COFFEE_GRINDER: GuideSpec = {
  sample: 'coffee-grinder',
  currency: 'EUR',
  axis: 'y',
  tags: ['coffee', 'grinder', 'burrs'],
  apartMm: {
    [GRINDER_PARTS.hopper]: 120,
    [GRINDER_PARTS.upperBurr]: 80,
    [GRINDER_PARTS.chute]: 60,
    [GRINDER_PARTS.lowerBurr]: 50,
    [GRINDER_PARTS.shaft]: 30,
    [GRINDER_PARTS.basePlate]: -40,
    [GRINDER_PARTS.groundsTray]: -70,
    [GRINDER_PARTS.housing]: 0,
    [GRINDER_PARTS.motor]: 0,
  },
  steps: GRINDER_STEPS,
  versions: [
    {
      stepKeys: ['unplug', 'hopper', 'lower', 'upper', 'fitnew'],
      stepTextOverrides: { fitnew: GRINDER_EARLIER_TEXT },
      pricing: {
        [GRINDER_PARTS.lowerBurr]: { unitPrice: 1640, quantity: 1, fittedAtKey: 'fitnew' },
        [GRINDER_PARTS.chute]: { unitPrice: 240, quantity: 1, fittedAtKey: null },
      },
    },
    {
      stepKeys: ['hopper', 'lower', 'upper', 'fitnew', 'closeup'],
      stepTextOverrides: { fitnew: GRINDER_EARLIER_TEXT },
      pricing: {
        [GRINDER_PARTS.lowerBurr]: { unitPrice: 1640, quantity: 1, fittedAtKey: 'fitnew' },
        [GRINDER_PARTS.chute]: { unitPrice: 240, quantity: 1, fittedAtKey: 'closeup' },
      },
    },
    {
      stepKeys: ['hopper', 'upper', 'lower', 'fitnew', 'closeup'],
      pricing: {
        [GRINDER_PARTS.lowerBurr]: { unitPrice: 1890, quantity: 1, fittedAtKey: 'fitnew' },
        [GRINDER_PARTS.chute]: { unitPrice: 240, quantity: 1, fittedAtKey: 'closeup' },
      },
    },
  ],
};

const HUB_PARTS = {
  shell: 'Hub shell[0]',
  axle: 'Axle[0]',
  leftCone: 'Left cone[0]',
  rightCone: 'Right cone[0]',
  leftBearing: 'Left bearing[0]',
  rightBearing: 'Right bearing[0]',
  freehub: 'Freehub body[0]',
  locknutLeft: 'Locknut[0]',
  locknutRight: 'Locknut[1]',
} as const;

export const BIKE_HUB: GuideSpec = {
  sample: 'bike-hub',
  currency: 'GBP',
  axis: 'x',
  tags: ['bike', 'hub', 'bearings'],
  apartMm: {
    [HUB_PARTS.locknutLeft]: -90,
    [HUB_PARTS.locknutRight]: 90,
    [HUB_PARTS.leftCone]: -60,
    [HUB_PARTS.rightCone]: 60,
    [HUB_PARTS.leftBearing]: -35,
    [HUB_PARTS.rightBearing]: 35,
    [HUB_PARTS.axle]: 120,
    [HUB_PARTS.freehub]: 50,
    [HUB_PARTS.shell]: 0,
  },
  steps: {
    locknuts: {
      key: 'locknuts',
      title: 'Undo the locknuts',
      phase: 'open_up',
      explode: 0,
      focus: [HUB_PARTS.locknutLeft, HUB_PARTS.locknutRight],
      yaw: 20,
      pitch: 10,
      text: 'Hold one cone with a thin spanner and turn each locknut off.',
    },
    axle: {
      key: 'axle',
      title: 'Slide out the axle',
      phase: 'take_out',
      explode: 0.4,
      focus: [HUB_PARTS.axle],
      yaw: 40,
      pitch: 15,
      text: 'Pull the axle out from the freehub side and catch the cones.',
    },
    bearings: {
      key: 'bearings',
      title: 'Fit new bearings',
      phase: 'fit_new',
      explode: 0.7,
      focus: [HUB_PARTS.leftBearing, HUB_PARTS.rightBearing],
      yaw: 60,
      pitch: 20,
      text: 'Press a new bearing into each side of the shell until it sits flat.',
    },
    cones: {
      key: 'cones',
      title: 'Set the cones',
      phase: 'close_up',
      explode: 0.2,
      focus: [HUB_PARTS.leftCone, HUB_PARTS.rightCone],
      yaw: 40,
      pitch: 10,
      text: 'Thread the cones back on until the axle turns with no play.',
    },
    spin: {
      key: 'spin',
      title: 'Spin the wheel',
      phase: 'test_it',
      explode: 0,
      focus: [HUB_PARTS.shell],
      yaw: 20,
      pitch: 10,
      text: 'Spin the wheel and listen for grinding before you ride.',
    },
  },
  versions: [
    {
      stepKeys: ['locknuts', 'axle', 'bearings', 'cones', 'spin'],
      pricing: {
        [HUB_PARTS.leftBearing]: { unitPrice: 320, quantity: 1, fittedAtKey: 'bearings' },
        [HUB_PARTS.rightBearing]: { unitPrice: 320, quantity: 1, fittedAtKey: 'bearings' },
      },
    },
  ],
};

const PAD_PARTS = {
  frontShell: 'Front shell[0]',
  backShell: 'Back shell[0]',
  mainBoard: 'Main board[0]',
  leftStick: 'Left stick[0]',
  rightStick: 'Right stick[0]',
  leftModule: 'Left stick module[0]',
  rightModule: 'Right stick module[0]',
  buttonPad: 'Button pad[0]',
  battery: 'Battery[0]',
  triggerSpring: 'Trigger spring[0]',
} as const;

export const GAME_CONTROLLER: GuideSpec = {
  sample: 'game-controller',
  currency: 'JPY',
  axis: 'z',
  tags: ['controller', 'games', 'sticks'],
  apartMm: {
    [PAD_PARTS.backShell]: -60,
    [PAD_PARTS.battery]: -35,
    [PAD_PARTS.mainBoard]: -15,
    [PAD_PARTS.leftModule]: 15,
    [PAD_PARTS.rightModule]: 15,
    [PAD_PARTS.leftStick]: 40,
    [PAD_PARTS.rightStick]: 40,
    [PAD_PARTS.buttonPad]: 25,
    [PAD_PARTS.triggerSpring]: -25,
    [PAD_PARTS.frontShell]: 0,
  },
  steps: {
    open: {
      key: 'open',
      title: 'Open the shell',
      phase: 'open_up',
      explode: 0.3,
      focus: [PAD_PARTS.backShell],
      yaw: 25,
      pitch: 20,
      text: 'Undo the back screws and ease the clips apart with a plastic tool.',
    },
    module: {
      key: 'module',
      title: 'Fit the new stick module',
      phase: 'fit_new',
      explode: 0.8,
      focus: [PAD_PARTS.leftModule],
      yaw: 50,
      pitch: 30,
      text: 'Lift the board, swap the left stick module and press its connector home.',
    },
  },
  versions: [
    {
      stepKeys: ['open', 'module'],
      pricing: {
        [PAD_PARTS.leftModule]: { unitPrice: 1240, quantity: 1, fittedAtKey: 'module' },
      },
    },
  ],
};

export const START_ACCOUNT = {
  name: 'Odile Brandt',
  email: 'odile@pennywasher.example',
  password: 'workshop-bench-41',
} as const;

export const START_GUIDES = [
  { spec: COFFEE_GRINDER, title: 'Coffee grinder: fit new burrs', slug: 'coffee-grinder-fit-new-burrs' },
  { spec: BIKE_HUB, title: 'Bike hub: regrease the bearings', slug: 'bike-hub-regrease-the-bearings' },
  { spec: GAME_CONTROLLER, title: 'Game controller: replace a stick', slug: 'game-controller-replace-a-stick' },
] as const;

export const HOME_GUIDE_SLUG = 'coffee-grinder-fit-new-burrs';
