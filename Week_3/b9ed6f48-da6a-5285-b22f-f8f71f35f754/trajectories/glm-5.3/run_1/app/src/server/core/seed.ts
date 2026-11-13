/** Seed data: chapters, events, sources, sessions, prices and exhibit seeds. */

export interface SeedChapter {
  number: number;
  numeral: string;
  title: string;
  era: string;
  sightlineDeg: number;
  exhibit: 'spring' | 'rules' | 'classifier' | 'neighbours' | null;
  ownerEmail: string;
  body: string;
  plates: Array<{ caption: string }>;
  narrationTranscript: string;
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
      'Before the first office calculator, a machine could already hold a long sum in its brass and steel. The difference engines of the 1820s were built to grind through the arithmetic of polynomial tables, turning the crank of a handle into a column of right answers. Their inventors understood something that still shapes our machines: calculation is a material process, done by parts that move, carry and lock. A wheel advances one tooth at a time, and when it passes nine it tips its neighbour, an event we now call a carry. That small mechanical treaty between wheels is the first machine thought in this room. Printing the result at the same moment as computing it removed the copyist and the copying error alike, so the engine became an argument that correctness could be manufactured. Visitors who turn this sculpture find a numeral that only lines up from one viewpoint, which is how this whole exhibition rewards patience.',
    plates: [
      { caption: 'Plate I: A brass difference engine, drawn as a stack of number wheels.' },
      { caption: 'Plate II: The carrying mechanism, one wheel tipping its neighbour.' },
      { caption: 'Plate III: A printed table column, inked by the machine itself.' },
    ],
    narrationTranscript:
      'Welcome to the first room. Turn the sculpture until the shards settle, and you will see a wheel that counts. In here, arithmetic is a material process, performed by parts that move, carry and lock.',
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
      'A century before electronic logic, reasoning itself was written as algebra. Boole showed that the ordinary operations of thought, and, or, not, can be treated as quantities that combine by fixed laws. His algebra starts from a small alphabet of statements and derives every consequence by rule, with no appeal to intuition. For a long time this looked like an elegant dead end, a piece of pure mathematics with nothing to compute it. Then Shannon noticed that a network of switches is exactly a sentence in that alphabet, and the algebra of thought became the working language of circuits. This room holds the passage from ink to relay, from a page of symbols to a machine whose arms open and close along the same laws. The same sequence of ideas now sits inside every gate in every processor, and the vocabulary of a nineteenth-century logician became the grammar of the modern machine.',
    plates: [
      { caption: 'Plate I: A page of Boolean algebra, classes named by single letters.' },
      { caption: 'Plate II: A relay network, drawn as a sentence in switching algebra.' },
      { caption: 'Plate III: A truth table rendered as a grid of lamp states.' },
    ],
    narrationTranscript:
      'In this room, reasoning becomes algebra. Boole wrote and, or and not as quantities that combine by fixed laws, and Shannon later found those laws again inside networks of switches.',
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
      'The most influential computer of the twentieth century was made of paper. In 1936 a mathematician described a strip of squares, a moving head, and a table of instructions, and used that humble machine to say precisely what it means to compute. The paper machine does not exist to be built, it exists to be reasoned about, and it showed that any procedure a person can carry out mechanically is a procedure this machine can carry out too. That result drew the limits of the possible before a single electronic computer was sold. A few years later the stored program arrived, the idea that instructions should live in the same memory as the numbers they act on, and the paper machine became a blueprint for real hardware. Look for the moment in this room when a machine becomes a description of machines, and when the description becomes a floor plan.',
    plates: [
      { caption: 'Plate I: A tape of squares, the head resting over a marked cell.' },
      { caption: 'Plate II: A state table, one row per instruction of the machine.' },
      { caption: 'Plate III: A stored-program layout, code and data in one memory.' },
    ],
    narrationTranscript:
      'Here is a machine made of paper. A strip of squares, a moving head and a table of instructions are enough to say precisely what it means to compute.',
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
      'Two mathematicians and a logician proposed that a nerve cell could be drawn as a switch with a threshold. Give the model enough connected units and it can compute any logical function, which is a startling claim for a drawing of a brain cell made in 1943. The nerve sums its inputs and fires when the total passes a line, and networks of such units are the direct ancestors of the systems that recognise speech and images today. Feedback arrived at the same moment, the study of control and communication in animals and machines, and with it the idea that a machine can steer itself by comparing what happened with what was wanted. This room holds the plucked spring at the centre of that thinking: a system pushed away from rest that returns by its own laws, storing energy and spending it. Play with the stiffness and the damping and watch the difference between a spring that overshoots and one that does not.',
    plates: [
      { caption: 'Plate I: A neuron drawn as a threshold unit with weighted inputs.' },
      { caption: 'Plate II: A feedback loop, output returning to input through a gauge.' },
      { caption: 'Plate III: A damped oscillation traced across ruled paper.' },
    ],
    narrationTranscript:
      'A nerve cell drawn as a switch with a threshold. Push this sculpture and it returns to rest by its own laws, storing energy and spending it. Change the stiffness and the damping and the return changes character.',
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
      'Asked whether machines can think, a mathematician swapped the question for a test. Instead of defining thought, he proposed a conversation between a judge and two hidden players, one human, one machine, and asked whether the judge could tell them apart by their answers alone. The test is generous to the machine and strict with the judge, and it has outlived every attempt to replace it. A summer workshop in 1956 gave the new field its name, and the founding proposal was written in a tone of cheerful certainty about problems that remain open. This room is about how a field announces itself, and about how a question asked politely in a paper can outlast a century of answers. Notice that the test says nothing about what the machine knows, only about what it can be credited with saying.',
    plates: [
      { caption: 'Plate I: A judge and two hidden players, one human and one machine.' },
      { caption: 'Plate II: A typewritten conversation, answers side by side.' },
      { caption: 'Plate III: The Dartmouth proposal, dated summer 1956.' },
    ],
    narrationTranscript:
      'Can machines think? Rather than define thought, one mathematician proposed a game of conversation, and asked whether a judge could tell the human from the machine by their answers alone.',
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
      'When the general problems of intelligence proved stubborn, researchers turned to narrow expertise. A chemistry program inferred the shape of a molecule from the peaks of a mass spectrum, and it did so by consulting a list of written rules supplied by human experts. The idea travelled far: a system that configured computer orders entered daily use at a computer maker, and for a decade the expert system was the commercial face of machine intelligence. Rules are readable, auditable and easy to argue with, and they fail in instructive ways, since no one can write down all the exceptions a practitioner carries in their fingers. The exhibit in this room lets you write those rules yourself and watch twelve specimens fall into groups, or fall out of them. Order matters: the first rule that matches wins, exactly as it did in the systems that ran factories.',
    plates: [
      { caption: 'Plate I: A page of rules, each one a sentence with a consequence.' },
      { caption: 'Plate II: A mass spectrum, peaks annotated by the program.' },
      { caption: 'Plate III: A terminal showing a configuration list for an order.' },
    ],
    narrationTranscript:
      'In this room expertise is a list of written rules. Add a rule, change a value, and the specimens reclassify at once. The first rule that matches wins.',
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
      'A machine that learns to see was built from motors, potentiometers and a camera, and its learning rule is simple enough to state in one line: after each mistake, adjust the weights a little towards the right answer. The perceptron trained in front of audiences, and the optimism it generated was enormous. Then two critics proved exactly what a single layer of such units cannot compute, and the proof landed hard. Funding cooled, the papers stopped, and the field entered a winter that lasted more than a decade. This room keeps both halves of that story. The exhibit is the very rule that failed, and the winter is the honest lesson that a method must be measured on data it has not seen, which is why the exhibit scores itself on points held back from training. Move a training point and watch the boundary move; press train and watch it converge.',
    plates: [
      { caption: 'Plate I: The perceptron machine, camera above a grid of lights.' },
      { caption: 'Plate II: A decision boundary drawn between two classes of points.' },
      { caption: 'Plate III: A page of proofs about what one layer cannot do.' },
    ],
    narrationTranscript:
      'A machine that learns to see, and the winter that followed it. After each mistake, adjust the weights a little towards the right answer. The exhibit scores itself on points held back from training.',
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
      'Meaning can be measured by the company a word keeps. The earliest statistical translation worked by counting which words sit near which, and the same counting now runs inside systems that write prose and answer questions. A word becomes a position in a space of associations, so that river and shore sit near each other and far from vault, and a sentence can be treated as arithmetic on those positions. The exhibit in this room is a small such space with ten words in it. Choose a word and a context and watch the three nearest words recompute, which is the entire idea of word vectors in miniature. Notice how the context pulls the query somewhere new: bank near money is a different word from bank near river, even though the word never changed. That is the quiet trick that lets a machine hold several senses of one word in a single shape.',
    plates: [
      { caption: 'Plate I: A grid of co-occurrence counts, one row per word.' },
      { caption: 'Plate II: Word positions plotted as points in a plane.' },
      { caption: 'Plate III: Two senses of one word, each surrounded by its neighbours.' },
    ],
    narrationTranscript:
      'Meaning measured by company. A word becomes a position in a space of associations, so that river and shore sit near each other and far from vault. Choose a word and a context, and the nearest words recompute.',
  },
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
  { id: 'ev-1822-difference-engine', year: 1822, chapter: 1, title: 'A table-making engine', summary: 'Charles Babbage proposes a machine that computes mathematical tables by finite differences, ending copying errors.', sourceIds: [] },
  { id: 'ev-1843-lovelace-notes', year: 1843, chapter: 1, title: 'Notes that outgrow their source', summary: "Ada Lovelace's notes lay out a stepwise plan for Bernoulli numbers and argue the engine could work on symbols, not only numbers.", sourceIds: ['src-1'] },
  { id: 'ev-1854-laws-of-thought', year: 1854, chapter: 2, title: 'Logic becomes algebra', summary: 'George Boole sets out an algebra in which reasoning is calculation over true and false.', sourceIds: ['src-2'] },
  { id: 'ev-1937-switching-circuits', year: 1937, chapter: 2, title: 'Relays that reason', summary: "Claude Shannon shows that Boole's algebra can describe and simplify networks of electrical switches.", sourceIds: [] },
  { id: 'ev-1936-computable-numbers', year: 1936, chapter: 3, title: 'A machine made of paper', summary: 'Alan Turing imagines a machine reading and writing symbols on a tape and uses it to mark the limits of computation.', sourceIds: ['src-3'] },
  { id: 'ev-1945-edvac-report', year: 1945, chapter: 3, title: 'The stored program', summary: 'A draft report on the EDVAC describes keeping instructions in the same memory as data.', sourceIds: [] },
  { id: 'ev-1943-logical-neuron', year: 1943, chapter: 4, title: 'A neuron as a logic gate', summary: 'Warren McCulloch and Walter Pitts model nerve cells as threshold units that compute logical functions.', sourceIds: ['src-4'] },
  { id: 'ev-1948-cybernetics', year: 1948, chapter: 4, title: 'Feedback gets a name', summary: 'Norbert Wiener treats control and communication in animals and machines as one subject.', sourceIds: [] },
  { id: 'ev-1950-imitation-game', year: 1950, chapter: 5, title: 'Can machines think?', summary: 'Turing swaps the question for a conversational test he calls the imitation game.', sourceIds: ['src-5'] },
  { id: 'ev-1956-dartmouth', year: 1956, chapter: 5, title: 'A summer project', summary: 'A workshop at Dartmouth College gives artificial intelligence its name as a research field.', sourceIds: [] },
  { id: 'ev-1965-dendral', year: 1965, chapter: 6, title: 'Chemistry by rules', summary: 'Work begins on DENDRAL, which infers molecular structure from mass-spectrometry data using expert rules.', sourceIds: [] },
  { id: 'ev-1980-xcon', year: 1980, chapter: 6, title: 'Rules go to work', summary: 'XCON, a rule-based system that configures computer orders, enters daily use at a computer maker.', sourceIds: [] },
  { id: 'ev-1958-perceptron', year: 1958, chapter: 7, title: 'A machine that learns to see', summary: 'Frank Rosenblatt presents the perceptron, a learning rule that adjusts weights after each mistake.', sourceIds: ['src-6'] },
  { id: 'ev-1969-perceptrons-book', year: 1969, chapter: 7, title: 'The limits, in print', summary: 'A book by Marvin Minsky and Seymour Papert shows what single-layer perceptrons cannot compute, and funding cools.', sourceIds: ['src-7'] },
];

export interface SeedSource {
  id: string;
  citation: string;
}

export const SEED_SOURCES: SeedSource[] = [
  { id: 'src-1', citation: 'Ada Lovelace, notes on the Analytical Engine, 1843' },
  { id: 'src-2', citation: 'George Boole, An Investigation of the Laws of Thought, 1854' },
  { id: 'src-3', citation: 'Alan Turing, On Computable Numbers, 1936' },
  { id: 'src-4', citation: 'Warren McCulloch and Walter Pitts, A Logical Calculus of the Ideas Immanent in Nervous Activity, 1943' },
  { id: 'src-5', citation: 'Alan Turing, Computing Machinery and Intelligence, 1950' },
  { id: 'src-6', citation: 'Frank Rosenblatt, The Perceptron, 1958' },
  { id: 'src-7', citation: 'Marvin Minsky and Seymour Papert, Perceptrons, 1969' },
];

export interface SeedSession {
  id: string;
  title: string;
  plusDays: number;
  startsAtHour: number | null;
  startsAtMinute: number | null;
  roundedMinutes: number | null;
  durationMinutes: number;
  capacity: number;
}

export const SEED_SESSIONS: SeedSession[] = [
  { id: 'ses-lovelace', title: "Lovelace's Notes, Read Aloud", plusDays: 3, startsAtHour: 18, startsAtMinute: 30, roundedMinutes: null, durationMinutes: 60, capacity: 12 },
  { id: 'ses-perceptron', title: 'Inside the Perceptron', plusDays: 10, startsAtHour: 18, startsAtMinute: 30, roundedMinutes: null, durationMinutes: 60, capacity: 2 },
  { id: 'ses-rules', title: 'Rules, Rooms and Reason', plusDays: 0, startsAtHour: null, startsAtMinute: null, roundedMinutes: 20, durationMinutes: 45, capacity: 10 },
];

export const SEED_PEOPLE = [
  { name: 'Ines Varela', email: 'ines@halden.test', role: 'curator' },
  { name: 'Priya Okonkwo', email: 'priya@halden.test', role: 'curator' },
  { name: 'Tomas Reiland', email: 'tomas@halden.test', role: 'lead_curator' },
  { name: 'Marta Solberg', email: 'marta@halden.test', role: 'manager' },
  { name: 'Ada Brennan', email: 'ada@visitor.test', role: 'visitor' },
  { name: 'Kenji Arai', email: 'kenji@visitor.test', role: 'visitor' },
] as const;

export const SEED_PASSWORD = 'Halden-demo-2026';

export const TIER_PRICES: Record<'reader' | 'fellow' | 'patron', Record<string, number>> = {
  reader: { EUR: 500, GBP: 400, USD: 600, JPY: 800 },
  fellow: { EUR: 1200, GBP: 1000, USD: 1400, JPY: 2000 },
  patron: { EUR: 3000, GBP: 2600, USD: 3500, JPY: 5000 },
};

export const TICKET_PRICES: Record<string, number> = {
  EUR: 1200,
  GBP: 1000,
  USD: 1400,
  JPY: 2000,
};

export const DONATION_MIN: Record<string, number> = { EUR: 100, GBP: 100, USD: 100, JPY: 100 };
export const DONATION_MAX: Record<string, number> = { EUR: 500000, GBP: 500000, USD: 500000, JPY: 500000 };

export const TIER_NAMES: Record<'reader' | 'fellow' | 'patron', string> = {
  reader: 'Reader',
  fellow: 'Fellow',
  patron: 'Patron',
};

export const NUMERALS: Record<number, string> = {
  1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII',
};
