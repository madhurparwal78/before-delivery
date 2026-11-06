import type { CycleKey, Priority, Status } from '../../shared/domain.js';

export interface SeedTask {
  number: number;
  title: string;
  department: string;
  label: string | null;
  status: Status;
  priority: Priority;
  owner: string | null;
  cycle: CycleKey;
  parent: number | null;
  blockedBy: number[];
}

const R1: CycleKey = 'rehearsal-1';
const R2: CycleKey = 'rehearsal-2';

function task(
  number: number,
  title: string,
  department: string,
  label: string | null,
  status: Status,
  priority: Priority,
  owner: string | null,
  cycle: CycleKey,
  parent: number | null = null,
  blockedBy: number[] = [],
): SeedTask {
  return { number, title, department, label, status, priority, owner, cycle, parent, blockedBy };
}

export const SEED_TASKS: SeedTask[] = [
  task(1, 'Upstage door sticks on the swing', 'carpentry', null, 'todo', 2, 'devi', R1),
  task(2, 'Stair unit stage right creaks on the third tread', 'carpentry', null, 'todo', 3, 'devi', R1),
  task(3, 'Add a masking flat at the stage left sight line', 'carpentry', null, 'todo', 3, 'devi', R1),
  task(4, 'Trim the bottom rail of the stage right wing flat', 'carpentry', null, 'todo', 4, 'devi', R1),
  task(5, 'Rebuild the trap lid hinge', 'carpentry', null, 'in_progress', 2, 'devi', R1),
  task(6, 'Brace the balcony rail', 'carpentry', null, 'todo', 1, 'devi', R1),
  task(7, 'Add a kick plate to the porch door', 'carpentry', null, 'backlog', 4, null, R1),
  task(8, 'Fix the wobble in the kitchen table leg', 'carpentry', null, 'todo', 3, 'devi', R1),
  task(9, 'Shim the window unit level', 'carpentry', null, 'todo', 4, 'devi', R1),
  task(10, 'Upstage door unit', 'carpentry', null, 'in_progress', 2, 'devi', R1),
  task(11, 'Re-hang the upstage door on rising butts', 'carpentry', null, 'done', 2, 'devi', R1, 10),
  task(12, 'Rebuild the upstage door flat', 'carpentry', null, 'in_progress', 1, 'devi', R1, 10),
  task(13, 'Repaint the upstage door flat', 'paint', null, 'todo', 2, 'sasha', R1, null, [12]),
  task(14, 'Touch up the back wall scumble around the door unit', 'paint', null, 'todo', 3, 'sasha', R1, null, [10]),
  task(15, 'Glue down the lifting floor cloth seam', 'carpentry', null, 'todo', 3, 'devi', R2),
  task(16, 'Add a handrail to the offstage escape stair', 'carpentry', null, 'todo', 2, 'devi', R2),
  task(17, 'Replace the cracked bench seat', 'carpentry', null, 'backlog', 4, null, R2),
  task(18, 'Silence the casters on the bar wagon', 'carpentry', null, 'todo', 3, 'devi', R2),
  task(19, 'Re-cut the window shutter to clear the sill', 'carpentry', null, 'todo', 4, 'devi', R2),
  task(20, 'Fit a stop block to the revolve jack', 'carpentry', null, 'todo', 2, 'devi', R2),
  task(21, 'Focus: area 1 downstage left', 'lighting', 'focus', 'todo', 3, 'ines', R1),
  task(22, 'Focus: area 2 downstage centre', 'lighting', 'focus', 'todo', 3, 'ines', R1),
  task(23, 'Focus: area 3 downstage right', 'lighting', 'focus', 'todo', 3, 'ines', R1),
  task(24, 'Focus: area 4 upstage left', 'lighting', 'focus', 'todo', 3, 'ines', R1),
  task(25, 'Focus: area 5 upstage centre', 'lighting', 'focus', 'todo', 3, 'ines', R1),
  task(26, 'Focus: stage left boom after masking', 'lighting', 'focus', 'todo', 3, 'ines', R1, null, [3]),
  task(27, 'Focus: porch door special', 'lighting', 'focus', 'todo', 3, 'ines', R1),
  task(28, 'Focus: window gobo', 'lighting', 'focus', 'todo', 3, 'ines', R1),
  task(29, 'Focus: kitchen table pool', 'lighting', 'focus', 'todo', 3, 'ines', R1),
  task(30, 'Focus: stair special', 'lighting', 'focus', 'todo', 3, 'ines', R1),
  task(31, 'Focus: trap special', 'lighting', 'focus', 'todo', 3, 'ines', R1),
  task(32, 'Focus: curtain call wash', 'lighting', 'focus', 'todo', 3, 'ines', R1),
  task(33, 'Build the storm sequence cues 40 to 46', 'lighting', 'programming', 'todo', 2, 'ines', R1),
  task(34, 'Slow the fade in cue 12', 'lighting', 'programming', 'todo', 3, 'ines', R1),
  task(35, 'Add a preset for the preshow', 'lighting', 'programming', 'backlog', 4, 'ines', R1),
  task(36, 'Replace the flickering lamp on the second electric', 'lighting', 'electrics', 'in_progress', 2, 'ines', R1),
  task(37, 'Focus: upstage door special', 'lighting', 'focus', 'todo', 2, 'ines', R1, null, [13]),
  task(38, 'Doorbell cue fires late in scene 4', 'sound', 'cues', 'todo', 2, 'kofi', R1),
  task(39, 'Thunder cue too loud in the stalls', 'sound', 'cues', 'todo', 3, 'kofi', R1),
  task(40, 'Hum on the stage left foldback speaker', 'sound', 'system', 'in_progress', 1, 'kofi', R1),
  task(41, 'Build a platform for the quick-change booth', 'carpentry', null, 'todo', 2, 'devi', R2, null, [53]),
  task(42, 'Source a period telephone', 'props', null, 'in_progress', 3, 'oren', R1),
  task(43, 'Breakaway plate for the dinner scene', 'props', null, 'todo', 2, 'oren', R1),
  task(44, 'Add felt pads to the teacups', 'props', null, 'todo', 4, 'oren', R1),
  task(45, 'Preset the lantern on the porch table', 'props', null, 'backlog', 4, null, R1),
  task(46, 'Focus: balcony specials', 'lighting', 'focus', 'todo', 3, 'ines', R1, null, [6]),
  task(47, 'Re-rig the mic pack in the Act 1 coat lining', 'sound', 'system', 'todo', 3, 'kofi', R1, null, [48]),
  task(48, 'Costume: Act 1 coat for Ada', 'wardrobe', null, 'in_progress', 2, 'ruth', R1),
  task(49, 'First fitting for the Act 1 coat', 'wardrobe', 'fitting', 'done', 3, 'ruth', R1, 48),
  task(50, 'Take in the Act 1 coat at the side seams', 'wardrobe', 'alteration', 'done', 3, 'ruth', R1, 48),
  task(51, 'Swap the coat hooks for a zip for the quick-change', 'wardrobe', 'quick-change', 'in_progress', 2, 'ruth', R1, 48),
  task(52, 'Costume: Act 2 waistcoat for Jonah', 'wardrobe', null, 'todo', 3, 'ruth', R1),
  task(53, 'Confirm the quick-change booth size', 'wardrobe', 'quick-change', 'todo', 2, 'ruth', R1),
  task(54, 'First fitting for the Act 2 waistcoat', 'wardrobe', 'fitting', 'todo', 3, 'ruth', R1, 52),
  task(55, 'Let out the Act 2 waistcoat at the back seam', 'wardrobe', 'alteration', 'todo', 4, 'ruth', R1, 52),
  task(56, 'Refresh the faded spike marks at the kitchen table', 'props', null, 'backlog', 3, null, R1),
  task(57, 'Re-glue the loose banister cap', 'carpentry', null, 'backlog', 4, null, R2),
  task(58, 'Fog machine for the storm scene', 'lighting', null, 'cancelled', 0, null, R1),
  task(59, 'Replace the worn rug edge tape', 'props', null, 'backlog', 4, null, R1),
  task(60, 'Set a battery change schedule for the radio mics', 'sound', 'system', 'backlog', 4, null, R1),
];

export interface SeedRequest {
  title: string;
  details: string;
  requester: string;
  department: string;
}

export const SEED_REQUESTS: SeedRequest[] = [
  {
    title: 'The upstage door still sticks when it swings shut',
    details: 'Caught it twice on the Act 1 entrance.',
    requester: 'Leon Park',
    department: 'carpentry',
  },
  {
    title: 'Bring the thunder in after the line about barring the door',
    details: 'It currently lands before the line.',
    requester: 'Leon Park',
    department: 'sound',
  },
  {
    title: 'Lose the rocking chair in Act 2, it slows the scene change',
    details: '',
    requester: 'Hana Ito',
    department: 'props',
  },
];
