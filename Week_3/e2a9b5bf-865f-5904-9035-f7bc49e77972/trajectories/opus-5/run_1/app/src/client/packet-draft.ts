import { draftRowsFor } from '../shared/completeness.js';
import { rulesFor, viewSubjects } from './derive.js';
import { appState } from './state.js';

/** Build packet's rows: each program object's representative observation. */
export function draftObservationIdsFor(programId: string): string[] {
  const program = appState().copy.programs.find((entry) => entry.id === programId);
  if (!program) return [];
  return draftRowsFor(viewSubjects(), rulesFor(program)).map((subject) => subject.id);
}
