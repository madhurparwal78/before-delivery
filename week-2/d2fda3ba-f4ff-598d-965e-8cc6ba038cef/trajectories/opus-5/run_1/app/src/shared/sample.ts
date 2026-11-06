import type { CandidateNote } from './boundary';

export type SampleNote = Omit<CandidateNote, 'id'>;

/** The sample case loaded into an empty local notebook. */
export const SAMPLE_CASE: readonly SampleNote[] = [
  {
    title: 'Port Ellery fuel contracts',
    aliases: [],
    frontmatter: { case: 'PE-2026-03' },
    private: false,
    body:
      '# What we found\n\nThe 2025 fuel tender is laid out in [[Tender timeline 2025]]. ' +
      'The winning bidder was [[Saltmarsh Logistics]], confirmed by the [[Tender award letter]]. ' +
      'Pricing was checked with [[Harbour pilot, Vigo|a harbour pilot]].',
  },
  {
    title: 'Tender timeline 2025',
    aliases: [],
    frontmatter: {},
    private: false,
    body: '- 3 March: tender opens, run by [[Mara Quint]].\n- 28 March: board approves, see [[Board minutes, March]].',
  },
  {
    title: 'Saltmarsh Logistics',
    aliases: ['Saltmarsh'],
    frontmatter: {},
    private: false,
    body:
      'Registered in Port Ellery. Fuel is supplied through [[Ellery Bunkering SA]]. ' +
      'Tender contact: [[Mara Quint]].',
  },
  {
    title: 'Tender award letter',
    aliases: [],
    frontmatter: {},
    private: false,
    body:
      'Approval recorded in [[Board minutes, March]]; summary in [[Port Ellery fuel contracts]].\n\n' +
      'Pasted from the scraped portal:\n\n' +
      "<script>alert('x')</script>\n\n" +
      '<img src="x" onerror="alert(\'x\')">\n\n' +
      "[portal copy](javascript:alert('x')) and [registry](https://registry.example/filing/2291)",
  },
  {
    title: 'Mara Quint',
    aliases: ['M. Quint'],
    frontmatter: { role: 'procurement officer' },
    private: false,
    body: 'Ran the tender. Reports to [[D. Hallam]]. Bid sheet came from [[Procurement clerk]].',
  },
  {
    title: 'Board minutes, March',
    aliases: [],
    frontmatter: {},
    private: false,
    body: 'The board approved the award. [[M. Quint]] presented.',
  },
  {
    title: 'Ellery Bunkering SA',
    aliases: [],
    frontmatter: {},
    private: false,
    body: 'Filing history in [[Registry filing 2024]].',
  },
  {
    title: 'D. Hallam',
    aliases: [],
    frontmatter: {},
    private: false,
    body: 'Director. Also sits on [[Northgate Holdings]].',
  },
  {
    title: 'Registry filing 2024',
    aliases: [],
    frontmatter: {},
    private: false,
    body: 'Lists [[Northgate Holdings]] as majority owner.',
  },
  {
    title: 'Northgate Holdings',
    aliases: [],
    frontmatter: {},
    private: false,
    body: 'Parent company. Unconfirmed: [[Offshore account lead]].',
  },
  {
    title: 'Offshore account lead',
    aliases: ['Cayman lead'],
    frontmatter: { status: 'unverified tip-off' },
    private: false,
    body: 'Tip received by phone. Do not publish.',
  },
  {
    title: 'Harbour pilot, Vigo',
    aliases: ['Pilot V.'],
    frontmatter: { contact: 'signal only' },
    private: true,
    body: 'Met twice at the marina. Confirms [[Ellery Bunkering SA]] delivery volumes.',
  },
  {
    title: 'Procurement clerk',
    aliases: ['Clerk K.'],
    frontmatter: {},
    private: true,
    body: 'Handed over the bid sheet. Links to [[Northgate Holdings]].',
  },
  {
    title: 'Call log scratch',
    aliases: [],
    frontmatter: {},
    private: false,
    body: 'Unanswered calls to the registry office.',
  },
];
