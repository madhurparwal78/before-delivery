// Seed content (brief: Seed data). Chapter texts, narration transcripts and plate captions are
// original writing for this exhibition; historical facts are restated in our own words.
const INES = "ines@halden.test";
const PRIYA = "priya@halden.test";
export const SEED_CHAPTERS = [
    {
        number: 1,
        numeral: "I",
        title: "Wheels That Count",
        era: "1820–1850",
        sightline: 33,
        exhibit: null,
        owner: INES,
        body: `In the 1820s the printed table was the working memory of science and trade. Navigators, actuaries and engineers trusted columns of logarithms that had been computed by hand and copied by hand, and every copy carried fresh mistakes. Charles Babbage proposed to take the person out of the arithmetic. His Difference Engine would turn brass wheels through the method of finite differences, adding the same few numbers again and again until a whole table emerged, and it would set the result in type so that no clerk could slip.

The engine was never finished in his lifetime, yet the idea outgrew its purpose. Babbage sketched a second machine, the Analytical Engine, with a store for numbers, a mill that worked on them and punched cards that told it what to do next. Ada Lovelace, translating a paper about it, added notes three times longer than the original. She wrote out a plan for computing Bernoulli numbers step by step and suggested that such a machine might act on any symbols whose relations could be stated, music included. This room begins with wheels that count and ends with the question of what else counting can do.`,
        transcript: "Before machines could think, they had to count without tiring. Babbage wanted brass wheels to compute tables that clerks had copied with errors for generations. Ada Lovelace looked at his plans and saw something larger: a machine that might work on any symbols, if only their rules could be written down.",
        plates: ["Plate I.1 — A train of counting wheels, drawn as concentric gear rings.", "Plate I.2 — The difference method laid out as stepped columns.", "Plate I.3 — A punched card lattice for an engine that follows instructions."],
    },
    {
        number: 2,
        numeral: "II",
        title: "The Algebra of Thought",
        era: "1850–1940",
        sightline: -21,
        exhibit: null,
        owner: INES,
        body: `George Boole, a schoolteacher turned professor in Cork, asked whether the rules of sound reasoning could be written like the rules of arithmetic. In 1854 he answered with an algebra whose quantities could only be true or false. Statements became symbols, "and" behaved like multiplication, "or" like a careful kind of addition, and a valid argument became a calculation that anyone could check line by line.

For decades this looked like a philosopher's curiosity. Then, in 1937, a young engineer named Claude Shannon noticed that the telephone relays clicking in exchange buildings were either open or closed, exactly like Boole's two values. Networks of switches could be described by his algebra, and, better still, simplified by it, saving copper and relays. The bridge between logic and electricity was complete. A circuit could now embody an argument, and a wiring diagram could be proved correct before a single wire was soldered. Every chip in the room around you still rests on that small, stubborn algebra of yes and no.`,
        transcript: "Boole turned reasoning into a kind of arithmetic with only two values, true and false. Eighty years later Claude Shannon saw the same two values in the relays of a telephone exchange, and logic became something you could build out of switches.",
        plates: ["Plate II.1 — A lattice of true and false, drawn as a field of open and closed cells.", "Plate II.2 — Relay contacts arranged as a switching network.", "Plate II.3 — Two inputs meeting in a gate, rendered as crossing rules."],
    },
    {
        number: 3,
        numeral: "III",
        title: "Paper Machines",
        era: "1936–1950",
        sightline: 12,
        exhibit: null,
        owner: INES,
        body: `In 1936 Alan Turing described a machine that existed only on paper. It read one symbol at a time from an endless tape, wrote a symbol back, moved left or right and changed its internal state according to a short table of rules. The device was deliberately humble, yet Turing showed that a single such machine, given the right table on its tape, could imitate any other. He also showed that some questions, such as whether an arbitrary machine will ever stop, can never be settled by any machine at all.

Within a decade the paper machine acquired valves and wires. The first electronic computers of the 1940s were set up by plugging cables, a process that could take days. A draft report on the EDVAC proposed a cleaner idea: keep the instructions in the same memory as the numbers, so a program could be loaded, changed or even rewritten by the machine itself. That stored-program design is still the shape of the computer on your desk, and it began as a thought experiment about a pencil, a rubber and a strip of paper.`,
        transcript: "Turing imagined the simplest possible machine: a head that reads and writes symbols on a strip of tape. That paper machine marked the limits of what any computer can do, and the stored-program computers of the 1940s gave it a body.",
        plates: ["Plate III.1 — An endless tape of cells, each holding a single mark.", "Plate III.2 — A table of rules drawn as a grid of states.", "Plate III.3 — Memory holding both numbers and instructions."],
    },
    {
        number: 4,
        numeral: "IV",
        title: "The Thinking Nerve",
        era: "1943–1960",
        sightline: -45,
        exhibit: "spring",
        owner: INES,
        body: `In 1943 the neurophysiologist Warren McCulloch and the young logician Walter Pitts published a startling simplification of the brain. They treated a nerve cell as a unit that adds up the signals arriving at it and fires only when the total passes a threshold. With the right thresholds, such units could compute "and", "or" and "not", so a net of them could in principle compute anything a logic circuit could.

At the same time Norbert Wiener was studying how gun directors, thermostats and living bodies correct themselves. He called the shared science cybernetics: control and communication through feedback, whether in metal or in flesh. A system that measures its own error and pushes back against it can settle, overshoot or ring like a struck bell, depending on how strongly it responds and how much it resists. The spring sculpture in this room lets you feel that difference. Change its stiffness and damping, pluck it, and watch whether it trembles, glides or crawls back to rest.`,
        transcript: "McCulloch and Pitts imagined a neuron as a tiny logic gate that fires when its inputs pass a threshold. Wiener saw feedback everywhere, in machines and in bodies. Pluck the spring in this room and watch feedback settle it back to rest.",
        plates: ["Plate IV.1 — Threshold units joined into a small net.", "Plate IV.2 — A feedback loop drawn as a returning curve.", "Plate IV.3 — Damped oscillation, a wave that fades to stillness."],
    },
    {
        number: 5,
        numeral: "V",
        title: "The Imitation Game",
        era: "1950–1960",
        sightline: 48,
        exhibit: null,
        owner: PRIYA,
        body: `"Can machines think?" Turing thought the question was too vague to answer, so in 1950 he replaced it with a game. An interrogator types questions to two hidden players, one human and one machine, and tries to tell which is which. If the machine is mistaken for the person often enough, Turing argued, we have little ground for denying it some kind of thought. He then answered, one by one, the objections he expected, from theology to the claim that machines can only do what they are told.

Six years later a small group of researchers spent a summer at Dartmouth College on a bolder bet: that every feature of learning and intelligence could be described precisely enough for a machine to simulate it. The proposal gave the field its name, artificial intelligence, and its early optimism. Programs soon proved geometry theorems and played draughts, and some of their authors predicted that human-level machines were only a generation away. The game Turing proposed is still argued over, and still played.`,
        transcript: "Turing swapped the question of machine thought for a game of conversation. A few years later a summer workshop at Dartmouth gave artificial intelligence its name, and its founders expected far quicker success than history would allow.",
        plates: ["Plate V.1 — Two hidden voices behind a ruled screen.", "Plate V.2 — Lines of typed questions and answers.", "Plate V.3 — A summer seminar table, seen from above."],
    },
    {
        number: 6,
        numeral: "VI",
        title: "Rules of the Expert",
        era: "1965–1990",
        sightline: -6,
        exhibit: "rules",
        owner: PRIYA,
        body: `By the mid-1960s some researchers had stopped searching for a general recipe for intelligence and started interviewing specialists instead. At Stanford, the DENDRAL project captured how chemists read a mass spectrum and turned that knowledge into rules a program could apply, proposing molecular structures that fitted the data. The lesson was striking: a modest reasoning engine plus a large body of expert rules could rival a trained person in a narrow field.

The approach went to work in industry. XCON, built for a computer manufacturer, checked and completed customer orders, choosing cables, cabinets and boards from thousands of rules and saving the company large sums each year. Expert systems became a boom, then a bust, as rule bases grew too tangled to maintain and the world kept producing cases nobody had written a rule for. The rule engine in this room shows both the power and the fragility. Rules fire in order, the first match wins, and a single new line can quietly change how a whole collection is sorted.`,
        transcript: "Expert systems wrote a specialist's knowledge down as rules and let a program apply them in order. They worked brilliantly in narrow places, and broke in surprising ways when a case arrived that no rule expected. Try the rule engine and watch the specimens move.",
        plates: ["Plate VI.1 — A branching tree of if-then rules.", "Plate VI.2 — A spectrum read as peaks and valleys.", "Plate VI.3 — Ordered rules, the first match drawn in bold."],
    },
    {
        number: 7,
        numeral: "VII",
        title: "The Perceptron's Winter",
        era: "1958–1986",
        sightline: 27,
        exhibit: "classifier",
        owner: PRIYA,
        body: `In 1958 the psychologist Frank Rosenblatt demonstrated a machine that learned from its mistakes. His perceptron weighed its inputs, made a guess and, whenever the guess was wrong, nudged each weight in the direction that would have helped. Repeated over many examples, the nudges drew a straight boundary that separated one kind of pattern from another. Newspapers greeted it as the embryo of an electronic brain.

The limits arrived in print in 1969, when Marvin Minsky and Seymour Papert analysed precisely what a single layer of such units could and could not compute. Some simple distinctions, they showed, no straight boundary could ever make. Funding for neural networks cooled for more than a decade, a period later remembered as a winter. Work continued quietly, and in the 1980s methods for training several layers at once brought the idea back. The classifier in this room is Rosenblatt's original rule. Move a training point, train it again, and judge it only on points it has never seen.`,
        transcript: "Rosenblatt's perceptron learned by adjusting its weights after every mistake. Minsky and Papert later proved what a single layer could never learn, and the field went quiet for years. Move the training points and see how the boundary answers.",
        plates: ["Plate VII.1 — Two clouds of points split by one straight line.", "Plate VII.2 — Weights drawn as rods of differing length.", "Plate VII.3 — A frost pattern for the long winter of funding."],
    },
    {
        number: 8,
        numeral: "VIII",
        title: "Words Near Words",
        era: "1954–2020",
        sightline: -33,
        exhibit: "neighbours",
        owner: PRIYA,
        body: `Linguists in the 1950s offered a working principle that later shaped language machines: you can learn a great deal about a word from the company it keeps. Words that appear in similar contexts tend to mean similar things. For a long time the principle was a guide for human analysts. As text became plentiful and computers fast, it became a recipe a machine could follow.

The recipe turns each word into a list of numbers, a point in a space with many directions, placed so that words used alike sit near one another. Nearness is measured by the angle between two points as seen from the origin, so length matters less than direction. The same space lets context shift meaning. Add the direction of "river" to "bank" and its nearest neighbours drift towards water and shore; add "money" and they drift towards loans and vaults. The neighbours exhibit in this room uses a tiny space of ten words and three directions, small enough to read, but built on exactly that idea.`,
        transcript: "A word can be known by the company it keeps. Turn each word into a direction in space and words used alike point the same way. Add a context and watch the neighbours of bank drift from rivers to money.",
        plates: ["Plate VIII.1 — Words as stars in a small constellation.", "Plate VIII.2 — The angle between two directions, drawn from the origin.", "Plate VIII.3 — A context vector pulling neighbours aside."],
    },
];
export const SEED_SOURCES = [
    ["src-1", "Ada Lovelace, notes on the Analytical Engine, 1843"],
    ["src-2", "George Boole, An Investigation of the Laws of Thought, 1854"],
    ["src-3", "Alan Turing, On Computable Numbers, 1936"],
    ["src-4", "Warren McCulloch and Walter Pitts, A Logical Calculus of the Ideas Immanent in Nervous Activity, 1943"],
    ["src-5", "Alan Turing, Computing Machinery and Intelligence, 1950"],
    ["src-6", "Frank Rosenblatt, The Perceptron, 1958"],
    ["src-7", "Marvin Minsky and Seymour Papert, Perceptrons, 1969"],
];
export const SEED_EVENTS = [
    { id: "ev-1822-difference-engine", year: 1822, chapter: 1, title: "A table-making engine", summary: "Charles Babbage proposes a machine that computes mathematical tables by finite differences, ending copying errors.", sources: [] },
    { id: "ev-1843-lovelace-notes", year: 1843, chapter: 1, title: "Notes that outgrow their source", summary: "Ada Lovelace's notes lay out a stepwise plan for Bernoulli numbers and argue the engine could work on symbols, not only numbers.", sources: ["src-1"] },
    { id: "ev-1854-laws-of-thought", year: 1854, chapter: 2, title: "Logic becomes algebra", summary: "George Boole sets out an algebra in which reasoning is calculation over true and false.", sources: ["src-2"] },
    { id: "ev-1937-switching-circuits", year: 1937, chapter: 2, title: "Relays that reason", summary: "Claude Shannon shows that Boole's algebra can describe and simplify networks of electrical switches.", sources: [] },
    { id: "ev-1936-computable-numbers", year: 1936, chapter: 3, title: "A machine made of paper", summary: "Alan Turing imagines a machine reading and writing symbols on a tape and uses it to mark the limits of computation.", sources: ["src-3"] },
    { id: "ev-1945-edvac-report", year: 1945, chapter: 3, title: "The stored program", summary: "A draft report on the EDVAC describes keeping instructions in the same memory as data.", sources: [] },
    { id: "ev-1943-logical-neuron", year: 1943, chapter: 4, title: "A neuron as a logic gate", summary: "Warren McCulloch and Walter Pitts model nerve cells as threshold units that compute logical functions.", sources: ["src-4"] },
    { id: "ev-1948-cybernetics", year: 1948, chapter: 4, title: "Feedback gets a name", summary: "Norbert Wiener treats control and communication in animals and machines as one subject.", sources: [] },
    { id: "ev-1950-imitation-game", year: 1950, chapter: 5, title: "Can machines think?", summary: "Turing swaps the question for a conversational test he calls the imitation game.", sources: ["src-5"] },
    { id: "ev-1956-dartmouth", year: 1956, chapter: 5, title: "A summer project", summary: "A workshop at Dartmouth College gives artificial intelligence its name as a research field.", sources: [] },
    { id: "ev-1965-dendral", year: 1965, chapter: 6, title: "Chemistry by rules", summary: "Work begins on DENDRAL, which infers molecular structure from mass-spectrometry data using expert rules.", sources: [] },
    { id: "ev-1980-xcon", year: 1980, chapter: 6, title: "Rules go to work", summary: "XCON, a rule-based system that configures computer orders, enters daily use at a computer maker.", sources: [] },
    { id: "ev-1958-perceptron", year: 1958, chapter: 7, title: "A machine that learns to see", summary: "Frank Rosenblatt presents the perceptron, a learning rule that adjusts weights after each mistake.", sources: ["src-6"] },
    { id: "ev-1969-perceptrons-book", year: 1969, chapter: 7, title: "The limits, in print", summary: "A book by Marvin Minsky and Seymour Papert shows what single-layer perceptrons cannot compute, and funding cools.", sources: ["src-7"] },
];
