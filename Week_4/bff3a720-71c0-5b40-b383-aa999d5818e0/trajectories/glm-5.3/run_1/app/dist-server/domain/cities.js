export const CITIES = [
    'Kestrevel',
    'Vardholm',
    'Brisanne',
    'Oakhythe',
    'Tollemarch',
    'Saint Ivrel',
    'Corrandy',
    'Hesketh Mere',
];
export const CITY_SET = new Set(CITIES);
const PAIRS = [
    ['Kestrevel', 'Brisanne', 67],
    ['Kestrevel', 'Oakhythe', 126],
    ['Kestrevel', 'Tollemarch', 213],
    ['Kestrevel', 'Vardholm', 70],
    ['Kestrevel', 'Saint Ivrel', 136],
    ['Kestrevel', 'Corrandy', 230],
    ['Kestrevel', 'Hesketh Mere', 77],
    ['Brisanne', 'Oakhythe', 59],
    ['Brisanne', 'Tollemarch', 146],
    ['Brisanne', 'Vardholm', 88],
    ['Brisanne', 'Saint Ivrel', 95],
    ['Brisanne', 'Corrandy', 173],
    ['Brisanne', 'Hesketh Mere', 99],
    ['Oakhythe', 'Tollemarch', 87],
    ['Oakhythe', 'Vardholm', 131],
    ['Oakhythe', 'Saint Ivrel', 84],
    ['Oakhythe', 'Corrandy', 127],
    ['Oakhythe', 'Hesketh Mere', 146],
    ['Tollemarch', 'Vardholm', 211],
    ['Tollemarch', 'Saint Ivrel', 134],
    ['Tollemarch', 'Corrandy', 99],
    ['Tollemarch', 'Hesketh Mere', 224],
    ['Vardholm', 'Saint Ivrel', 95],
    ['Vardholm', 'Corrandy', 196],
    ['Vardholm', 'Hesketh Mere', 146],
    ['Saint Ivrel', 'Corrandy', 101],
    ['Saint Ivrel', 'Hesketh Mere', 191],
    ['Corrandy', 'Hesketh Mere', 270],
];
const TABLE = new Map();
for (const [a, b, km] of PAIRS) {
    TABLE.set(a + '|' + b, km);
    TABLE.set(b + '|' + a, km);
}
export function distanceKm(from, to) {
    if (from === to)
        return 0;
    return TABLE.get(from + '|' + to) ?? null;
}
export function allDistances() {
    return PAIRS.map(([from, to, km]) => ({ from, to, km }));
}
