import type { Axis, Currency, Phase } from '../shared/types';

export interface StepSeed { title: string; text: string; phase: Phase; explode: number; focus: string[]; yaw: number; pitch: number }

export interface GuideSeed {
  sample: string;
  currency: Currency;
  tags: string[];
  axis: Axis;
  /** apart distance in millimetres by node path */
  apart: Record<string, number>;
  /** fitted-new parts: node path -> [step key, price per version number or one price for all] */
  fitted: Record<string, { step: string; price: number | Record<number, number>; from?: number }>;
  steps: Record<string, StepSeed>;
  /** version number -> step keys in order, with per-version text overrides */
  versions: Record<number, { order: string[]; text?: Record<string, string> }>;
  titleForOdile: string;
  slugForOdile: string;
}

export const coffeeGrinder: GuideSeed = {
  sample: 'coffee-grinder',
  currency: 'EUR',
  tags: ['coffee', 'grinder', 'burrs'],
  axis: 'y',
  apart: {
    'Housing[0]/Hopper[0]': 120, 'Housing[0]/Upper burr[0]': 80, 'Housing[0]/Bean chute[0]': 60,
    'Housing[0]/Drive shaft[0]/Lower burr[0]': 50, 'Housing[0]/Drive shaft[0]': 30, 'Base plate[0]': -40, 'Grounds tray[0]': -70,
  },
  fitted: {
    'Housing[0]/Drive shaft[0]/Lower burr[0]': { step: 'fit', price: { 1: 1640, 2: 1640, 3: 1890 } },
    'Housing[0]/Bean chute[0]': { step: 'chute', price: 240, from: 2 },
  },
  steps: {
    unplug: { title: 'Unplug and empty the grinder', text: 'Unplug the grinder and tip out any beans.', phase: 'open_up', explode: 0, focus: ['Housing[0]/Hopper[0]'], yaw: 30, pitch: 15 },
    hopper: { title: 'Lift off the hopper', text: 'Unplug the grinder, then turn the hopper a quarter turn and lift it straight up.', phase: 'open_up', explode: 0, focus: ['Housing[0]/Hopper[0]'], yaw: 30, pitch: 15 },
    upper: { title: 'Free the upper burr', text: 'Undo the two clips and lift the upper burr out by its handle.', phase: 'take_out', explode: 0.25, focus: ['Housing[0]/Upper burr[0]'], yaw: 45, pitch: 20 },
    lower: { title: 'Draw out the lower burr', text: 'Pull the lower burr straight up off the drive shaft without twisting it.', phase: 'take_out', explode: 0.5, focus: ['Housing[0]/Drive shaft[0]/Lower burr[0]', 'Housing[0]/Drive shaft[0]'], yaw: 60, pitch: 10 },
    fit: { title: 'Fit the new burr set', text: 'Seat the new burrs and turn them a quarter turn until they click.', phase: 'fit_new', explode: 0.85, focus: ['Housing[0]/Upper burr[0]', 'Housing[0]/Drive shaft[0]/Lower burr[0]'], yaw: 60, pitch: 25 },
    chute: { title: 'Refit the chute and close up', text: 'Press the new chute home, then refit the hopper and run a few beans through.', phase: 'close_up', explode: 0, focus: ['Housing[0]/Bean chute[0]'], yaw: 30, pitch: 15 },
  },
  versions: {
    1: { order: ['unplug', 'hopper', 'lower', 'upper', 'fit'], text: { fit: 'Seat the new burrs and turn them a quarter turn by hand.' } },
    2: { order: ['hopper', 'lower', 'upper', 'fit', 'chute'], text: { fit: 'Seat the new burrs and turn them a quarter turn by hand.' } },
    3: { order: ['hopper', 'upper', 'lower', 'fit', 'chute'] },
  },
  titleForOdile: 'Coffee grinder: fit new burrs',
  slugForOdile: 'coffee-grinder-fit-new-burrs',
};

export const bikeHub: GuideSeed = {
  sample: 'bike-hub',
  currency: 'GBP',
  tags: ['bike', 'hub', 'bearings'],
  axis: 'x',
  apart: {
    'Locknut[0]': -90, 'Locknut[1]': 90, 'Left cone[0]': -60, 'Right cone[0]': 60, 'Left bearing[0]': -35, 'Right bearing[0]': 35,
    'Axle[0]': 120, 'Freehub body[0]': 50, 'Hub shell[0]': 0,
  },
  fitted: {
    'Left bearing[0]': { step: 'bearings', price: 320 },
    'Right bearing[0]': { step: 'bearings', price: 320 },
  },
  steps: {
    locknuts: { title: 'Undo the locknuts', text: 'Hold one cone with a thin spanner and turn each locknut off.', phase: 'open_up', explode: 0, focus: ['Locknut[0]', 'Locknut[1]'], yaw: 20, pitch: 10 },
    axle: { title: 'Slide out the axle', text: 'Pull the axle out from the freehub side and catch the cones.', phase: 'take_out', explode: 0.4, focus: ['Axle[0]'], yaw: 40, pitch: 15 },
    bearings: { title: 'Fit new bearings', text: 'Press a new bearing into each side of the shell until it sits flat.', phase: 'fit_new', explode: 0.7, focus: ['Left bearing[0]', 'Right bearing[0]'], yaw: 60, pitch: 20 },
    cones: { title: 'Set the cones', text: 'Thread the cones back on until the axle turns with no play.', phase: 'close_up', explode: 0.2, focus: ['Left cone[0]', 'Right cone[0]'], yaw: 40, pitch: 10 },
    spin: { title: 'Spin the wheel', text: 'Spin the wheel and listen for grinding before you ride.', phase: 'test_it', explode: 0, focus: ['Hub shell[0]'], yaw: 20, pitch: 10 },
  },
  versions: { 1: { order: ['locknuts', 'axle', 'bearings', 'cones', 'spin'] } },
  titleForOdile: 'Bike hub: regrease the bearings',
  slugForOdile: 'bike-hub-regrease-the-bearings',
};

export const gameController: GuideSeed = {
  sample: 'game-controller',
  currency: 'JPY',
  tags: ['controller', 'games', 'sticks'],
  axis: 'z',
  apart: {
    'Back shell[0]': -60, 'Battery[0]': -35, 'Main board[0]': -15, 'Left stick module[0]': 15, 'Right stick module[0]': 15,
    'Left stick[0]': 40, 'Right stick[0]': 40, 'Button pad[0]': 25, 'Trigger spring[0]': -25, 'Front shell[0]': 0,
  },
  fitted: { 'Left stick module[0]': { step: 'module', price: 1240 } },
  steps: {
    open: { title: 'Open the shell', text: 'Undo the back screws and ease the clips apart with a plastic tool.', phase: 'open_up', explode: 0.3, focus: ['Back shell[0]'], yaw: 25, pitch: 20 },
    module: { title: 'Fit the new stick module', text: 'Lift the board, swap the left stick module and press its connector home.', phase: 'fit_new', explode: 0.8, focus: ['Left stick module[0]'], yaw: 50, pitch: 30 },
  },
  versions: { 1: { order: ['open', 'module'] } },
  titleForOdile: 'Game controller: replace a stick',
  slugForOdile: 'game-controller-replace-a-stick',
};
