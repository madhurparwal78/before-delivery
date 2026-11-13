// The published data kinds and levels, read once from the server.

import { api } from './api.js';

let vocabulary = { kinds: [], levels: [] };

export async function loadVocabulary() {
    vocabulary = await api.get('/api/kinds');
    return vocabulary;
}

export function kinds() {
    return vocabulary.kinds;
}

export function levels() {
    return vocabulary.levels;
}

export function kindLabel(code) {
    const found = vocabulary.kinds.find((kind) => kind.code === code);
    return found ? found.label : code;
}

export function levelLabel(code) {
    const found = vocabulary.levels.find((level) => level.code === code);
    return found ? found.label : code;
}
