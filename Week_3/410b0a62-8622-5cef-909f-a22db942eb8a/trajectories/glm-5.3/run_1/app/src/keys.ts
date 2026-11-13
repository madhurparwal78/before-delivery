/** Object-storage key for a workout's original activity file. */
export function storageKeyFor(athleteId: string, workoutId: string, isCsv: boolean): string {
  return `activities/${athleteId}/${workoutId}.${isCsv ? 'csv' : 'json'}`;
}

export function contentTypeFor(isCsv: boolean): string {
  return isCsv ? 'text/csv' : 'application/json';
}

