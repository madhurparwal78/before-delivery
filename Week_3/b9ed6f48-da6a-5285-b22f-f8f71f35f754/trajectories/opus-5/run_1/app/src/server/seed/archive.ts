import type { ExhibitKey } from '../../shared/exhibits.js';
import type { Role } from '../../shared/types.js';

export interface SeedAccount {
  name: string;
  email: string;
  role: Role;
}

export const SEED_PASSWORD = 'Halden-demo-2026';

export const SEED_ACCOUNTS: SeedAccount[] = [
  { name: 'Ines Varela', email: 'ines@halden.test', role: 'curator' },
  { name: 'Priya Okonkwo', email: 'priya@halden.test', role: 'curator' },
  { name: 'Tomas Reiland', email: 'tomas@halden.test', role: 'lead_curator' },
  { name: 'Marta Solberg', email: 'marta@halden.test', role: 'manager' },
  { name: 'Ada Brennan', email: 'ada@visitor.test', role: 'visitor' },
  { name: 'Kenji Arai', email: 'kenji@visitor.test', role: 'visitor' },
];

export const LEAD_CURATOR_EMAIL = 'tomas@halden.test';

export interface SeedChapter {
  number: number;
  numeral: string;
  title: string;
  era: string;
  sightlineDeg: number;
  exhibit: ExhibitKey | null;
  ownerEmail: string;
  body: string;
  transcript: string;
}

export const SEED_CHAPTERS: SeedChapter[] = [
  {
    number: 1,
    numeral: 'I',
    title: 'Wheels That Count',
    era: '1820–1850',
    sightlineDeg: 33,
    exhibit: null,
    ownerEmail: 'ines@halden.test',
    body:
      'Counting came before thinking. The first room of this exhibition is full of brass: toothed wheels, carry levers and columns of figures that a clerk would otherwise have copied by hand, badly. ' +
      'The engines proposed in London in the 1820s were meant to remove the copyist altogether, printing their own tables so that no error could creep in between the calculation and the page. ' +
      'What makes the room belong in a history of machine thought is not the gearing but the notes written beside it. A machine that moves numbers along a fixed path can also be told to move symbols, ' +
      'provided someone describes the path in advance. That description, written out as a sequence of steps with places where the sequence turns back on itself, is the oldest object in the building that we would now call a program. ' +
      'The wheels never ran at full scale. The argument did.',
    transcript:
      'Chapter one, Wheels That Count. Counting came before thinking. These brass wheels were built to remove the copyist from the production of mathematical tables, ' +
      'and the notes written beside them argued that a machine moving numbers could move symbols too, if someone wrote the steps down first.',
  },
  {
    number: 2,
    numeral: 'II',
    title: 'The Algebra of Thought',
    era: '1850–1940',
    sightlineDeg: -21,
    exhibit: null,
    ownerEmail: 'ines@halden.test',
    body:
      'In 1854 a Lincoln schoolmaster published an investigation into the laws of thought, and reasoning quietly became a kind of arithmetic. ' +
      'Statements were given the values of true and false; the words and, or and not became operations; a chain of argument became an expression that could be simplified like any other. ' +
      'The move looks modest on paper and was enormous in consequence, because an expression that can be simplified can also be mechanised. ' +
      'Eighty years later a graduate student noticed that the same algebra described networks of electrical relays: a switch is open or closed, a circuit conducts or does not, ' +
      'and the rules for combining them are exactly the rules for combining propositions. From that moment logic had a body. The cabinets in this room hold both halves of the discovery, ' +
      'the printed page and the clicking relay, and they say the same thing in two materials.',
    transcript:
      'Chapter two, The Algebra of Thought. Reasoning was given the values true and false, and the words and, or and not became operations. ' +
      'Eighty years later the same algebra was found to describe networks of electrical relays, and logic acquired a body.',
  },
  {
    number: 3,
    numeral: 'III',
    title: 'Paper Machines',
    era: '1936–1950',
    sightlineDeg: 12,
    exhibit: null,
    ownerEmail: 'ines@halden.test',
    body:
      'The machine in this room is made of paper, and it was imagined in order to be limited. A tape, a reading head, a finite table of instructions: nothing else. ' +
      'The point of such poverty was to pin down what counted as a definite method at all, and then to show that some perfectly clear questions have no definite method behind them. ' +
      'The limit was the result; the machine was the instrument that proved it. Within a decade the instrument had become a plan for hardware. ' +
      'A draft report circulated in 1945 proposed keeping instructions in the same memory as the data they worked on, so that a machine could be redirected by writing to it rather than by rewiring it. ' +
      'Everything on the shelves after this point in the exhibition depends on that one decision, which is why the room is kept deliberately bare.',
    transcript:
      'Chapter three, Paper Machines. A tape, a reading head and a finite table of instructions were enough to pin down what counts as a definite method, ' +
      'and to show that some clear questions have none. A later report proposed storing instructions in the same memory as the data.',
  },
  {
    number: 4,
    numeral: 'IV',
    title: 'The Thinking Nerve',
    era: '1943–1960',
    sightlineDeg: -45,
    exhibit: 'spring',
    ownerEmail: 'ines@halden.test',
    body:
      'Two researchers in Chicago asked in 1943 what a nerve cell does, and answered that it adds up what reaches it and fires if the total passes a threshold. ' +
      'Written that way, a neuron is a logic gate, and a web of neurons computes. The claim was anatomically thin and conceptually decisive: brains and machines could now be discussed in one vocabulary. ' +
      'Around the same time a wider programme gathered under the name cybernetics, which treated control and communication in animals and machines as a single subject, ' +
      'with feedback as its central idea. The sculpture in this room is a chain of shards on a spring. Pluck it and watch the energy leave: lightly damped, it rings for a long time; ' +
      'heavily damped, it slumps back without a single overshoot. Regulation, the room argues, is not a metaphor borrowed from engineering. It is the thing itself.',
    transcript:
      'Chapter four, The Thinking Nerve. A nerve cell was described as a unit that sums its inputs and fires above a threshold, which makes a neuron a logic gate. ' +
      'Feedback became the central idea of cybernetics, and the spring in this room shows what damping does to a system left to settle.',
  },
  {
    number: 5,
    numeral: 'V',
    title: 'The Imitation Game',
    era: '1950–1960',
    sightlineDeg: 48,
    exhibit: null,
    ownerEmail: 'priya@halden.test',
    body:
      'Asked whether machines can think, the 1950 paper in this case refuses the question and offers a substitute: a conversation, conducted in writing, in which an interrogator tries to tell a machine from a person. ' +
      'The substitution is the argument. If we cannot say what thinking is, we can at least say what would count as evidence, and then get on with the engineering. ' +
      'Six years later a summer workshop in New Hampshire gave the engineering a name, and artificial intelligence became a field with budgets, students and quarrels. ' +
      'The exhibits here are mostly paper: proposals, objections and the long list of reasons the test was said to be too easy, too hard or beside the point. ' +
      'Read together they show a discipline deciding, in public, what it would accept as proof.',
    transcript:
      'Chapter five, The Imitation Game. Rather than define thinking, a 1950 paper proposed a written conversation in which an interrogator tries to tell a machine from a person. ' +
      'A summer workshop six years later gave the new field its name.',
  },
  {
    number: 6,
    numeral: 'VI',
    title: 'Rules of the Expert',
    era: '1965–1990',
    sightlineDeg: -6,
    exhibit: 'rules',
    ownerEmail: 'priya@halden.test',
    body:
      'If knowledge is what makes an expert, then knowledge can be written down, and a machine that holds enough of it will be expert too. ' +
      'That was the wager of the rule-based systems, and for a while it paid. A programme begun in 1965 inferred molecular structure from mass-spectrometry data by applying rules a chemist had dictated. ' +
      "Fifteen years later a configurator checked computer orders for consistency and did it well enough to become part of a company's daily paperwork. " +
      'The machinery is simple enough to put on a label: a list of conditions, each with a conclusion, tried in order until one fits. ' +
      'The exhibit here lets you edit that list over twelve specimens and watch the labels change as you go. What the room also records is the cost: ' +
      'every rule had to be argued for, maintained, and reconciled with the rules already there.',
    transcript:
      'Chapter six, Rules of the Expert. If expertise can be written down, a machine holding enough rules will be expert too. ' +
      'The exhibit lets you edit a list of conditions and conclusions, tried in order, and watch twelve specimens take their labels.',
  },
  {
    number: 7,
    numeral: 'VII',
    title: "The Perceptron's Winter",
    era: '1958–1986',
    sightlineDeg: 27,
    exhibit: 'classifier',
    ownerEmail: 'priya@halden.test',
    body:
      'The perceptron presented in 1958 learned. Shown an example and told it had erred, it nudged its own weights in the direction that would have been right, and repeated this until the mistakes stopped. ' +
      'Nothing was programmed in; the behaviour was found. The press coverage was extravagant and the mathematics was honest about the limits, but it was a book published in 1969 that made the limits famous, ' +
      "showing clearly what a single layer of such units cannot compute. Funding cooled, students went elsewhere, and the decade that followed is the winter in the room's title. " +
      'The exhibit here is the learning rule itself, running on sixteen points you can drag about, scored on eight points it never sees during training. ' +
      'Move one point far enough and the line that separated the classes stops separating anything.',
    transcript:
      "Chapter seven, The Perceptron's Winter. Shown an example and told it had erred, the perceptron nudged its own weights towards the right answer. " +
      'A book in 1969 made the limits of a single layer famous, and funding cooled. The exhibit runs the learning rule on points you can move.',
  },
  {
    number: 8,
    numeral: 'VIII',
    title: 'Words Near Words',
    era: '1954–2020',
    sightlineDeg: -33,
    exhibit: 'neighbours',
    ownerEmail: 'priya@halden.test',
    body:
      'A word, the linguists said, is known by the company it keeps. Count the company carefully enough and a word becomes a position: a list of numbers, placed in a space where closeness means similarity of use. ' +
      'The idea is old and the arithmetic is simple, but it changed what machines could do with language, because positions can be added, compared and sorted, and meanings could not. ' +
      'The exhibit in this room holds ten words with three coordinates each. Ask for the neighbours of bank and you are told shore and water or money and loan, ' +
      'depending entirely on which context you add to the query. Nothing in the machine knows what a river is. It knows only which words sit near which, ' +
      'and that turns out to be enough to be useful and never enough to be safe.',
    transcript:
      'Chapter eight, Words Near Words. A word is known by the company it keeps, so counting that company turns a word into a position in a space where closeness means similar use. ' +
      'Ask for the neighbours of bank and the answer depends on the context you add.',
  },
];

export interface SeedSource {
  id: string;
  ordinal: number;
  citation: string;
}

export const SEED_SOURCES: SeedSource[] = [
  { id: 'src-1', ordinal: 1, citation: 'Ada Lovelace, notes on the Analytical Engine, 1843' },
  { id: 'src-2', ordinal: 2, citation: 'George Boole, An Investigation of the Laws of Thought, 1854' },
  { id: 'src-3', ordinal: 3, citation: 'Alan Turing, On Computable Numbers, 1936' },
  {
    id: 'src-4',
    ordinal: 4,
    citation:
      'Warren McCulloch and Walter Pitts, A Logical Calculus of the Ideas Immanent in Nervous Activity, 1943',
  },
  { id: 'src-5', ordinal: 5, citation: 'Alan Turing, Computing Machinery and Intelligence, 1950' },
  { id: 'src-6', ordinal: 6, citation: 'Frank Rosenblatt, The Perceptron, 1958' },
  { id: 'src-7', ordinal: 7, citation: 'Marvin Minsky and Seymour Papert, Perceptrons, 1969' },
];

export interface SeedEvent {
  id: string;
  year: number;
  chapter: number;
  title: string;
  summary: string;
  sourceIds: string[];
}

export const SEED_EVENTS: SeedEvent[] = [
  {
    id: 'ev-1822-difference-engine',
    year: 1822,
    chapter: 1,
    title: 'A table-making engine',
    summary:
      'Charles Babbage proposes a machine that computes mathematical tables by finite differences, ending copying errors.',
    sourceIds: [],
  },
  {
    id: 'ev-1843-lovelace-notes',
    year: 1843,
    chapter: 1,
    title: 'Notes that outgrow their source',
    summary:
      "Ada Lovelace's notes lay out a stepwise plan for Bernoulli numbers and argue the engine could work on symbols, not only numbers.",
    sourceIds: ['src-1'],
  },
  {
    id: 'ev-1854-laws-of-thought',
    year: 1854,
    chapter: 2,
    title: 'Logic becomes algebra',
    summary: 'George Boole sets out an algebra in which reasoning is calculation over true and false.',
    sourceIds: ['src-2'],
  },
  {
    id: 'ev-1937-switching-circuits',
    year: 1937,
    chapter: 2,
    title: 'Relays that reason',
    summary: "Claude Shannon shows that Boole's algebra can describe and simplify networks of electrical switches.",
    sourceIds: [],
  },
  {
    id: 'ev-1936-computable-numbers',
    year: 1936,
    chapter: 3,
    title: 'A machine made of paper',
    summary:
      'Alan Turing imagines a machine reading and writing symbols on a tape and uses it to mark the limits of computation.',
    sourceIds: ['src-3'],
  },
  {
    id: 'ev-1945-edvac-report',
    year: 1945,
    chapter: 3,
    title: 'The stored program',
    summary: 'A draft report on the EDVAC describes keeping instructions in the same memory as data.',
    sourceIds: [],
  },
  {
    id: 'ev-1943-logical-neuron',
    year: 1943,
    chapter: 4,
    title: 'A neuron as a logic gate',
    summary: 'Warren McCulloch and Walter Pitts model nerve cells as threshold units that compute logical functions.',
    sourceIds: ['src-4'],
  },
  {
    id: 'ev-1948-cybernetics',
    year: 1948,
    chapter: 4,
    title: 'Feedback gets a name',
    summary: 'Norbert Wiener treats control and communication in animals and machines as one subject.',
    sourceIds: [],
  },
  {
    id: 'ev-1950-imitation-game',
    year: 1950,
    chapter: 5,
    title: 'Can machines think?',
    summary: 'Turing swaps the question for a conversational test he calls the imitation game.',
    sourceIds: ['src-5'],
  },
  {
    id: 'ev-1956-dartmouth',
    year: 1956,
    chapter: 5,
    title: 'A summer project',
    summary: 'A workshop at Dartmouth College gives artificial intelligence its name as a research field.',
    sourceIds: [],
  },
  {
    id: 'ev-1965-dendral',
    year: 1965,
    chapter: 6,
    title: 'Chemistry by rules',
    summary:
      'Work begins on DENDRAL, which infers molecular structure from mass-spectrometry data using expert rules.',
    sourceIds: [],
  },
  {
    id: 'ev-1980-xcon',
    year: 1980,
    chapter: 6,
    title: 'Rules go to work',
    summary: 'XCON, a rule-based system that configures computer orders, enters daily use at a computer maker.',
    sourceIds: [],
  },
  {
    id: 'ev-1958-perceptron',
    year: 1958,
    chapter: 7,
    title: 'A machine that learns to see',
    summary: 'Frank Rosenblatt presents the perceptron, a learning rule that adjusts weights after each mistake.',
    sourceIds: ['src-6'],
  },
  {
    id: 'ev-1969-perceptrons-book',
    year: 1969,
    chapter: 7,
    title: 'The limits, in print',
    summary:
      'A book by Marvin Minsky and Seymour Papert shows what single-layer perceptrons cannot compute, and funding cools.',
    sourceIds: ['src-7'],
  },
];

export type SeedSessionOffset =
  | { kind: 'days'; days: number; hour: number; minute: number }
  | { kind: 'minutes'; minutes: number };

export interface SeedSession {
  id: string;
  title: string;
  durationMinutes: number;
  capacity: number;
  offset: SeedSessionOffset;
}

export const SEED_SESSIONS: SeedSession[] = [
  {
    id: 'ses-lovelace',
    title: "Lovelace's Notes, Read Aloud",
    durationMinutes: 60,
    capacity: 12,
    offset: { kind: 'days', days: 3, hour: 18, minute: 30 },
  },
  {
    id: 'ses-perceptron',
    title: 'Inside the Perceptron',
    durationMinutes: 60,
    capacity: 2,
    offset: { kind: 'days', days: 10, hour: 18, minute: 30 },
  },
  {
    id: 'ses-rules',
    title: 'Rules, Rooms and Reason',
    durationMinutes: 45,
    capacity: 10,
    offset: { kind: 'minutes', minutes: 20 },
  },
];
