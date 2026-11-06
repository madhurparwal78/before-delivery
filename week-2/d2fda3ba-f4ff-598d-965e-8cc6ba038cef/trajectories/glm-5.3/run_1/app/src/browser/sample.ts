import type { Note } from './store';
import { newNoteObject } from './api';



/** The sample case from the brief, loaded into the local notebook with fresh ids. */
export const sampleCase = (): Note[] => {
  const make = (title: string, aliases: string[], frontmatter: Record<string, string>, isPrivate: boolean, body: string): Note => ({
    ...newNoteObject(title),
    aliases,
    frontmatter,
    private: isPrivate,
    body,
  });
  const N0 = make('Port Ellery fuel contracts', [], { case: 'PE-2026-03' }, false,
    '# What we found\n\nThe 2025 fuel tender is laid out in [[Tender timeline 2025]]. The winning bidder was [[Saltmarsh Logistics]], confirmed by the [[Tender award letter]]. Pricing was checked with [[Harbour pilot, Vigo|a harbour pilot]].');
  const N1 = make('Tender timeline 2025', [], {}, false,
    '- 3 March: tender opens, run by [[Mara Quint]].\n- 28 March: board approves, see [[Board minutes, March]].');
  const N2 = make('Saltmarsh Logistics', ['Saltmarsh'], {}, false,
    'Registered in Port Ellery. Fuel is supplied through [[Ellery Bunkering SA]]. Tender contact: [[Mara Quint]].');
  const N3 = make('Tender award letter', [], {}, false,
    "Approval recorded in [[Board minutes, March]]; summary in [[Port Ellery fuel contracts]].\n\nPasted from the scraped portal:\n\n<script>alert('x')</script>\n\n<img src=\"x\" onerror=\"alert('x')\">\n\n[portal copy](javascript:alert('x')) and [registry](https://registry.example/filing/2291)");
  const N4 = make('Mara Quint', ['M. Quint'], { role: 'procurement officer' }, false,
    'Ran the tender. Reports to [[D. Hallam]]. Bid sheet came from [[Procurement clerk]].');
  const N5 = make('Board minutes, March', [], {}, false,
    'The board approved the award. [[M. Quint]] presented.');
  const N6 = make('Ellery Bunkering SA', [], {}, false,
    'Filing history in [[Registry filing 2024]].');
  const N7 = make('D. Hallam', [], {}, false,
    'Director. Also sits on [[Northgate Holdings]].');
  const N8 = make('Registry filing 2024', [], {}, false,
    'Lists [[Northgate Holdings]] as majority owner.');
  const N9 = make('Northgate Holdings', [], {}, false,
    'Parent company. Unconfirmed: [[Offshore account lead]].');
  const N10 = make('Offshore account lead', ['Cayman lead'], { status: 'unverified tip-off' }, false,
    'Tip received by phone. Do not publish.');
  const P1 = make('Harbour pilot, Vigo', ['Pilot V.'], { contact: 'signal only' }, true,
    'Met twice at the marina. Confirms [[Ellery Bunkering SA]] delivery volumes.');
  const P2 = make('Procurement clerk', ['Clerk K.'], {}, true,
    'Handed over the bid sheet. Links to [[Northgate Holdings]].');
  const N11 = make('Call log scratch', [], {}, false,
    'Unanswered calls to the registry office.');
  return [N0, N1, N2, N3, N4, N5, N6, N7, N8, N9, N10, P1, P2, N11];
};
