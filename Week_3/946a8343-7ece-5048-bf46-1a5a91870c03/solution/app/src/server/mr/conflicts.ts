// The conflict page: hunks to choose between, read back from the marked text a conflicting file is shown with.

interface ConflictHunk {
  readonly ours: string[];
  readonly theirs: string[];
}

/** The `<<<<<<<` … `=======` … `>>>>>>>` regions of a marked text, in order. */
export function markedHunks(marked: string): ConflictHunk[] {
  const hunks: ConflictHunk[] = [];
  let ours: string[] | null = null;
  let theirs: string[] | null = null;
  for (const line of marked.split("\n")) {
    if (ours === null && line.startsWith("<<<<<<< ")) {
      ours = [];
    } else if (ours !== null && theirs === null && line.startsWith("=======")) {
      theirs = [];
    } else if (ours !== null && theirs !== null && line.startsWith(">>>>>>> ")) {
      hunks.push({ ours, theirs });
      ours = null;
      theirs = null;
    } else if (theirs !== null) {
      theirs.push(line);
    } else if (ours !== null) {
      ours.push(line);
    }
  }
  return hunks;
}
