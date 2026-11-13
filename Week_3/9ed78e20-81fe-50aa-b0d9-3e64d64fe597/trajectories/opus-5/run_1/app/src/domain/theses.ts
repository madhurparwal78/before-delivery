export type Thesis = {
  readonly number: number;
  readonly heading: string;
  readonly body: string;
};

export const ESSAY_TITLE = 'The open record of Aldermoor Labs';

export const THESES: readonly Thesis[] = [
  {
    number: 1,
    heading: 'A claim is only as good as the row beneath it.',
    body:
      'Every number we publish about a model is written down first as a row: a subject, a benchmark, a date, a score and a note on where the score came from. The prose on a model route may not invent a figure, round one upward, or quote a rival from a slide deck. If the row is not recorded, the sentence cannot be written.',
  },
  {
    number: 2,
    heading: 'Release is a decision with names on it.',
    body:
      'Nothing reaches this site because a deadline arrived. A route is read by an editor, signed for safety by one approver and for legal by another, checked against the recorded rows, and then cleared by somebody who did not write it. The console keeps those names, and the audit record keeps them in a chain that shows tampering.',
  },
  {
    number: 3,
    heading: 'Every surface tells the same story at the same moment.',
    body:
      'A release is one transaction. The route, the catalogue, the Models menu, the home rail, the feed, the sitemap, the ranked search and the linked announcement all change together, on whichever instance happens to serve you. An embargo that slips on one surface has slipped everywhere, so we do not let surfaces drift apart.',
  },
  {
    number: 4,
    heading: 'Withdrawal should be as thorough as publication.',
    body:
      'When an approver withdraws an item it leaves every list, count, facet, feed and index in the same breath, and its address says plainly that it has been withdrawn. Reading the record as it stood last month will not bring it back either. A retraction that survives in a tag list is not a retraction.',
  },
  {
    number: 5,
    heading: 'Candidates deserve to know where they stand.',
    body:
      'Anyone who applies to us gets a reference, a private link and the name of the stage they have reached. Recruiters record a reason for every move, and the candidate is told the new stage by email, addressed exactly as they wrote their own name. When a role closes, the people still in it hear about it.',
  },
];
