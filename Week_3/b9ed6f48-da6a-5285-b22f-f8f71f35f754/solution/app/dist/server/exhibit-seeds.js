// The exhibit seeds, exactly as published (brief: Seed data › Exhibit endpoint bodies).
const spring = {
    key: "spring",
    stiffness: { min: 50, max: 300, step: 10, initial: 170 },
    damping: { min: 2, max: 40, step: 1, initial: 26 },
};
const specimen = (name, legs, wings, feathers) => ({ name, legs, wings, feathers });
const rules = {
    key: "rules",
    specimens: [
        specimen("Robin", 2, true, true),
        specimen("Sparrow", 2, true, true),
        specimen("Penguin", 2, true, true),
        specimen("Bat", 2, true, false),
        specimen("Beetle", 6, true, false),
        specimen("Ant", 6, false, false),
        specimen("Dragonfly", 6, true, false),
        specimen("Spider", 8, false, false),
        specimen("Scorpion", 8, false, false),
        specimen("Cat", 4, false, false),
        specimen("Whale", 0, false, false),
        specimen("Ostrich", 2, true, true),
    ],
    rules: [
        { attribute: "feathers", value: true, label: "Bird" },
        { attribute: "legs", value: 6, label: "Insect" },
        { attribute: "legs", value: 8, label: "Arachnid" },
    ],
    attributes: { legs: { min: 0, max: 8 }, wings: [true, false], feathers: [true, false] },
    labels: ["Bird", "Insect", "Arachnid", "Mammal"],
    new_rule: { attribute: "legs", value: 4, label: "Mammal" },
    max_rules: 6,
};
const point = (x, y, label) => ({ x, y, label });
const classifier = {
    key: "classifier",
    grid: { min: 0, max: 10 },
    max_epochs: 20,
    training: [
        ...[[7, 8], [8, 6], [9, 9], [6, 9], [8, 8], [9, 7], [7, 6], [6, 7]].map(([x, y]) => point(x, y, "signal")),
        ...[[2, 3], [3, 1], [1, 2], [4, 2], [2, 5], [3, 4], [1, 4], [5, 1]].map(([x, y]) => point(x, y, "noise")),
    ],
    held_out: [
        ...[[8, 9], [7, 7], [5, 8], [9, 5]].map(([x, y]) => point(x, y, "signal")),
        ...[[2, 2], [4, 3], [3, 6], [6, 4]].map(([x, y]) => point(x, y, "noise")),
    ],
};
const neighbours = {
    key: "neighbours",
    words: [
        { word: "bank", vector: [2, 2, 0] },
        { word: "river", vector: [0, 4, 1] },
        { word: "shore", vector: [0, 3, 2] },
        { word: "water", vector: [1, 4, 0] },
        { word: "money", vector: [4, 0, 1] },
        { word: "loan", vector: [4, 1, 0] },
        { word: "vault", vector: [3, 0, 2] },
        { word: "engine", vector: [0, 0, 5] },
        { word: "gear", vector: [1, 0, 4] },
        { word: "memory", vector: [2, 1, 3] },
    ],
    contexts: ["river", "money", "engine"],
};
export const EXHIBIT_SEEDS = { spring, rules, classifier, neighbours };
