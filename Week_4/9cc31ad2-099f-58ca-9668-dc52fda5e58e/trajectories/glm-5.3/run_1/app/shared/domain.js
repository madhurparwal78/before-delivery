// Shared domain constants: cars, upgrades, layouts, events, classes, prices.
// This module is the single source of truth for the published tables in the brief.
export const CARS = [
    { carId: 'kestrel-hatch', name: 'Kestrel Hatch', class: 'D', pi: 220, price: null, starter: true,
        stats: { accelMps2: 4.0, brakeMps2: 8.0, topMps: 45, gripPct: 100, laneChangeSteps: 30 } },
    { carId: 'wren-coupe', name: 'Wren Coupe', class: 'D', pi: 230, price: null, starter: true,
        stats: { accelMps2: 3.6, brakeMps2: 8.5, topMps: 47, gripPct: 102, laneChangeSteps: 30 } },
    { carId: 'moth-roadster', name: 'Moth Roadster', class: 'D', pi: 215, price: null, starter: true,
        stats: { accelMps2: 4.2, brakeMps2: 7.5, topMps: 43, gripPct: 98, laneChangeSteps: 24 } },
    { carId: 'halcyon-rs', name: 'Halcyon RS', class: 'C', pi: 360, price: 4000, starter: false,
        stats: { accelMps2: 5.0, brakeMps2: 9.0, topMps: 52, gripPct: 106, laneChangeSteps: 24 } },
    { carId: 'ferrule-sport', name: 'Ferrule Sport', class: 'C', pi: 380, price: 5500, starter: false,
        stats: { accelMps2: 5.4, brakeMps2: 8.8, topMps: 54, gripPct: 104, laneChangeSteps: 24 } },
    { carId: 'vantor-8', name: 'Vantor 8', class: 'B', pi: 560, price: 12000, starter: false,
        stats: { accelMps2: 6.2, brakeMps2: 10.0, topMps: 60, gripPct: 110, laneChangeSteps: 18 } }
];
export const carById = (carId) => CARS.find(c => c.carId === carId);
export const CLASS_TOP = { D: 299, C: 499, B: 699 };
export const STAGES_PER_SYSTEM = 3;
export const SYSTEM_NAMES = {
    engine: 'Engine', tires: 'Tires', brakes: 'Brakes', suspension: 'Suspension'
};
export const SYSTEM_IDS = ['engine', 'tires', 'brakes', 'suspension'];
export const UPGRADE_EFFECTS = {
    engine: { stats: { accelMps2: 1.0, topMps: 2 }, pi: 20 },
    tires: { stats: { gripPct: 4 }, pi: 15 },
    brakes: { stats: { brakeMps2: 1.5 }, pi: 10 },
    suspension: { stats: { laneChangeSteps: -6 }, pi: 5 }
};
export const UPGRADE_PRICES = {
    D: [300, 700, 1500], C: [600, 1400, 3000], B: [1000, 2400, 5000]
};
export const upgradePrice = (cls, stage) => UPGRADE_PRICES[cls][stage - 1];
export const zeroStages = () => ({ engine: 0, tires: 0, brakes: 0, suspension: 0 });
/** Stats and PI for a car with the given per-system stages. */
export function setupFor(car, stages) {
    const stats = baseStats(car);
    let pi = car.pi;
    for (const sys of SYSTEM_IDS) {
        const effect = UPGRADE_EFFECTS[sys];
        for (let i = 0; i < stages[sys]; i++) {
            if (effect.stats.accelMps2 !== undefined)
                stats.accelMps2 += effect.stats.accelMps2;
            if (effect.stats.brakeMps2 !== undefined)
                stats.brakeMps2 += effect.stats.brakeMps2;
            if (effect.stats.topMps !== undefined)
                stats.topMps += effect.stats.topMps;
            if (effect.stats.gripPct !== undefined)
                stats.gripPct += effect.stats.gripPct;
            if (effect.stats.laneChangeSteps !== undefined)
                stats.laneChangeSteps += effect.stats.laneChangeSteps;
            pi += effect.pi;
        }
    }
    if (stats.laneChangeSteps < 6)
        stats.laneChangeSteps = 6;
    return { stats, pi };
}
export const baseStats = (car) => ({ ...car.stats });
export const isOverClassLimit = (car, pi) => pi > CLASS_TOP[car.class];
export const LAYOUTS = {
    'saltflat-ring': {
        layoutId: 'saltflat-ring',
        name: 'Saltflat Ring',
        length: 1200,
        corners: [
            { start: 300, end: 380, limit: 22, driftWeight: 1.0 },
            { start: 600, end: 660, limit: 14, driftWeight: 1.5 },
            { start: 1000, end: 1200, limit: 28, driftWeight: 1.2 }
        ],
        sectors: [380, 660, 1200],
        coins: [
            { at: 120, lane: 'middle' }, { at: 200, lane: 'middle' }, { at: 340, lane: 'left' },
            { at: 450, lane: 'right' }, { at: 520, lane: 'right' }, { at: 640, lane: 'left' },
            { at: 800, lane: 'middle' }, { at: 1100, lane: 'middle' }
        ]
    },
    'quarry-switchbacks': {
        layoutId: 'quarry-switchbacks',
        name: 'Quarry Switchbacks',
        length: 1000,
        corners: [
            { start: 200, end: 260, limit: 12, driftWeight: 1.5 },
            { start: 480, end: 560, limit: 16, driftWeight: 1.3 },
            { start: 800, end: 1000, limit: 20, driftWeight: 1.0 }
        ],
        sectors: [260, 560, 1000],
        coins: [
            { at: 100, lane: 'middle' }, { at: 230, lane: 'left' }, { at: 400, lane: 'middle' },
            { at: 520, lane: 'right' }, { at: 700, lane: 'middle' }, { at: 900, lane: 'left' }
        ]
    }
};
export const LAYOUT_IDS = ['saltflat-ring', 'quarry-switchbacks'];
export const layoutById = (id) => LAYOUT_IDS.includes(id) ? LAYOUTS[id] : undefined;
export const AI_FACTORS = { rookie: 1.15, pro: 1.04 };
export const EVENTS = {
    'guided-first-race': {
        eventId: 'guided-first-race', name: 'Guided first race', league: null, mode: 'practice',
        layoutId: 'saltflat-ring', class: 'D', laps: 1, aiCarIds: null, loanerCarId: null
    },
    'rookie-circuit': {
        eventId: 'rookie-circuit', name: 'Rookie Circuit', league: 'rookie', mode: 'circuit',
        layoutId: 'saltflat-ring', class: 'D', laps: 3, aiCarIds: ['kestrel-hatch', 'kestrel-hatch'], loanerCarId: 'kestrel-hatch'
    },
    'rookie-drift': {
        eventId: 'rookie-drift', name: 'Rookie Drift', league: 'rookie', mode: 'drift',
        layoutId: 'saltflat-ring', class: 'D', laps: 1, aiCarIds: null, loanerCarId: 'kestrel-hatch'
    },
    'rookie-time-trial': {
        eventId: 'rookie-time-trial', name: 'Rookie Time Trial', league: 'rookie', mode: 'time-trial',
        layoutId: 'saltflat-ring', class: 'D', laps: 3, aiCarIds: null, loanerCarId: 'kestrel-hatch'
    },
    'club-circuit': {
        eventId: 'club-circuit', name: 'Club Circuit', league: 'club', mode: 'circuit',
        layoutId: 'quarry-switchbacks', class: 'C', laps: 3, aiCarIds: ['halcyon-rs', 'halcyon-rs'], loanerCarId: 'halcyon-rs'
    },
    'club-time-trial': {
        eventId: 'club-time-trial', name: 'Club Time Trial', league: 'club', mode: 'time-trial',
        layoutId: 'quarry-switchbacks', class: 'C', laps: 3, aiCarIds: null, loanerCarId: 'halcyon-rs'
    }
};
export const EVENT_IDS = Object.keys(EVENTS);
export const LEAGUES = [
    { leagueId: 'rookie', name: 'Rookie league', eventIds: ['rookie-circuit', 'rookie-drift', 'rookie-time-trial'] },
    { leagueId: 'club', name: 'Club league', eventIds: ['club-circuit', 'club-time-trial'] }
];
export const LEAGUE_COMPLETE_POINTS = 50;
export const FINALS_REWARD = 1000;
export const OPENING_BALANCE = 1000;
export const CIRCUIT_RESULT_COINS = { 1: 600, 2: 400, 3: 300 };
export const CLEAN_BONUS_DIVISOR = 15;
export const GUIDED_FIRST_RACE_COINS = 300;
export const DRIFT_COIN_CAP = 500;
export const TIME_TRIAL_LAP_COINS = 250;
export const ONLINE_RESULT_COINS = { 1: 200, 2: 100 };
export const ONLINE_RESULT_LATER = 50;
export const LOANER_RESULT_DIVISOR = 2;
export const BOARD_MAX_ROWS = 50;
// Run defaults
export const DEFAULT_LAPS = { practice: 1, circuit: 3, drift: 1, 'time-trial': 3 };
export const LAP_RANGE = {
    practice: [1, 5], circuit: [3, 3], drift: [1, 1], 'time-trial': [1, 5]
};
/** The step limit for a run. */
export function stepLimitFor(mode, laps) {
    return mode === 'drift' ? 5400 : laps * 7200;
}
