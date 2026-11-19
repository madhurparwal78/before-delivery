/**
 * Every string on `/c/<token>`, its mail and the dossier's care card, in the
 * client's language. Nothing on that page comes from anywhere else.
 */
import type { Language } from './language.ts';

export type ClientCopyId =
  | 'C01' | 'C02' | 'C03' | 'C04' | 'C05' | 'C06' | 'C07' | 'C08' | 'C09' | 'C10'
  | 'C11' | 'C12' | 'C13' | 'C14' | 'C15' | 'C16' | 'C17' | 'C18' | 'C19' | 'C20'
  | 'C21' | 'C22' | 'C23' | 'C24' | 'C25' | 'C26' | 'C27' | 'C28' | 'C29' | 'C30'
  | 'C31' | 'C32' | 'C33' | 'C34' | 'C35' | 'C36' | 'C37' | 'C38' | 'C39' | 'C40'
  | 'C41' | 'C42' | 'C43' | 'C44' | 'C45' | 'C46' | 'C47' | 'C48' | 'C49' | 'C50'
  | 'C51' | 'C52'
  | 'M1' | 'M2' | 'M3' | 'M4'
  | 'K1' | 'K2';

type Row = Record<Language, string>;

export const CLIENT_COPY: Record<ClientCopyId, Row> = {
  C01: { en: 'Your piece', it: 'Il tuo pezzo', ja: '\u304a\u9810\u304b\u308a\u306e\u54c1', ar: '\u0642\u0637\u0639\u062a\u0643' },
  C02: { en: 'Steps', it: 'Passaggi', ja: '\u624b\u9806', ar: '\u0627\u0644\u062e\u0637\u0648\u0627\u062a' },
  C03: { en: 'Before and after', it: 'Prima e dopo', ja: '\u65bd\u5de5\u524d\u3068\u65bd\u5de5\u5f8c', ar: '\u0642\u0628\u0644 \u0648\u0628\u0639\u062f' },
  C04: { en: 'The cover', it: 'Il rivestimento', ja: '\u5f35\u5730', ar: '\u0627\u0644\u063a\u0637\u0627\u0621' },
  C05: { en: 'The estimate', it: 'Il preventivo', ja: '\u898b\u7a4d\u3082\u308a', ar: '\u0627\u0644\u062a\u0642\u062f\u064a\u0631' },
  C06: { en: 'Your answer', it: 'La tua risposta', ja: '\u3042\u306a\u305f\u306e\u56de\u7b54', ar: '\u0625\u062c\u0627\u0628\u062a\u0643' },
  C07: {
    en: 'What seat height would you like, in cm?',
    it: 'Quale altezza della seduta desideri, in cm?',
    ja: '\u3054\u5e0c\u671b\u306e\u5ea7\u9762\u306e\u9ad8\u3055\uff08cm\uff09\u3092\u6559\u3048\u3066\u304f\u3060\u3055\u3044\u3002',
    ar: '\u0645\u0627 \u0627\u0631\u062a\u0641\u0627\u0639 \u0627\u0644\u0645\u0642\u0639\u062f \u0627\u0644\u0630\u064a \u062a\u0641\u0636\u0644\u0647 \u0628\u0627\u0644\u0633\u0646\u062a\u064a\u0645\u062a\u0631\u061f',
  },
  C08: {
    en: 'Seat height in cm',
    it: 'Altezza della seduta in cm',
    ja: '\u5ea7\u9762\u306e\u9ad8\u3055\uff08cm\uff09',
    ar: '\u0627\u0631\u062a\u0641\u0627\u0639 \u0627\u0644\u0645\u0642\u0639\u062f \u0628\u0627\u0644\u0633\u0646\u062a\u064a\u0645\u062a\u0631',
  },
  C09: { en: 'Send my answer', it: 'Invia la risposta', ja: '\u56de\u7b54\u3092\u9001\u4fe1\u3059\u308b', ar: '\u0625\u0631\u0633\u0627\u0644 \u0625\u062c\u0627\u0628\u062a\u064a' },
  C10: { en: 'Your full name', it: 'Il tuo nome completo', ja: '\u304a\u540d\u524d\uff08\u30d5\u30eb\u30ca\u30fc\u30e0\uff09', ar: '\u0627\u0633\u0645\u0643 \u0627\u0644\u0643\u0627\u0645\u0644' },
  C11: {
    en: 'Approve this cover',
    it: 'Approva questo rivestimento',
    ja: '\u3053\u306e\u5f35\u5730\u3092\u627f\u8a8d\u3059\u308b',
    ar: '\u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u063a\u0637\u0627\u0621',
  },
  C12: { en: 'Close', it: 'Chiudi', ja: '\u9589\u3058\u308b', ar: '\u0625\u063a\u0644\u0627\u0642' },
  C13: {
    en: 'Write the height like 44.5.',
    it: "Scrivi l'altezza cos\u00ec: 44,5.",
    ja: '\u9ad8\u3055\u306f 44.5 \u306e\u3088\u3046\u306b\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
    ar: '\u0627\u0643\u062a\u0628 \u0627\u0644\u0627\u0631\u062a\u0641\u0627\u0639 \u0647\u0643\u0630\u0627: \u0664\u0664\u066b\u0665.',
  },
  C14: {
    en: 'That is not the name we hold. Type your full name.',
    it: 'Non \u00e8 il nome che abbiamo. Scrivi il tuo nome completo.',
    ja: '\u304a\u9810\u304b\u308a\u3057\u3066\u3044\u308b\u304a\u540d\u524d\u3068\u4e00\u81f4\u3057\u307e\u305b\u3093\u3002\u30d5\u30eb\u30ca\u30fc\u30e0\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
    ar: '\u0647\u0630\u0627 \u0644\u064a\u0633 \u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062c\u0644 \u0644\u062f\u064a\u0646\u0627. \u0627\u0643\u062a\u0628 \u0627\u0633\u0645\u0643 \u0627\u0644\u0643\u0627\u0645\u0644.',
  },
  C15: {
    en: 'Your answer is with the conservator.',
    it: 'La tua risposta \u00e8 arrivata al restauratore.',
    ja: '\u56de\u7b54\u3092\u4fee\u5fa9\u62c5\u5f53\u8005\u306b\u5c4a\u3051\u307e\u3057\u305f\u3002',
    ar: '\u0648\u0635\u0644\u062a \u0625\u062c\u0627\u0628\u062a\u0643 \u0625\u0644\u0649 \u0627\u0644\u0645\u0631\u0645\u0650\u0645.',
  },
  C16: {
    en: 'Approved at <time> <town> time.',
    it: 'Approvato alle <time>, ora di <town>.',
    ja: '<time>\uff08<town>\u6642\u9593\uff09\u306b\u627f\u8a8d\u3057\u307e\u3057\u305f\u3002',
    ar: '\u062a\u0645\u062a \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0641\u064a \u0627\u0644\u0633\u0627\u0639\u0629 <time> \u0628\u062a\u0648\u0642\u064a\u062a <town>.',
  },
  C17: {
    en: 'Already approved at <time> <town> time.',
    it: 'Gi\u00e0 approvato alle <time>, ora di <town>.',
    ja: '<time>\uff08<town>\u6642\u9593\uff09\u306b\u627f\u8a8d\u6e08\u307f\u3067\u3059\u3002',
    ar: '\u062a\u0645\u062a \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0628\u0627\u0644\u0641\u0639\u0644 \u0641\u064a \u0627\u0644\u0633\u0627\u0639\u0629 <time> \u0628\u062a\u0648\u0642\u064a\u062a <town>.',
  },
  C18: {
    en: 'A newer estimate was made at <time> Turin time. Read it first.',
    it: '\u00c8 stato fatto un preventivo pi\u00f9 recente alle <time>, ora di Torino. Leggilo prima.',
    ja: '<time>\uff08\u30c8\u30ea\u30ce\u6642\u9593\uff09\u306b\u65b0\u3057\u3044\u898b\u7a4d\u3082\u308a\u304c\u4f5c\u6210\u3055\u308c\u307e\u3057\u305f\u3002\u5148\u306b\u304a\u8aad\u307f\u304f\u3060\u3055\u3044\u3002',
    ar: '\u0623\u064f\u0639\u062f\u0651 \u062a\u0642\u062f\u064a\u0631 \u0623\u062d\u062f\u062b \u0641\u064a \u0627\u0644\u0633\u0627\u0639\u0629 <time> \u0628\u062a\u0648\u0642\u064a\u062a \u062a\u0648\u0631\u064a\u0646\u0648. \u0627\u0642\u0631\u0623\u0647 \u0623\u0648\u0644\u0627\u064b.',
  },
  C19: {
    en: 'Please answer by <date>.',
    it: 'Rispondi entro il <date>.',
    ja: '<date> \u307e\u3067\u306b\u3054\u56de\u7b54\u304f\u3060\u3055\u3044\u3002',
    ar: '\u064a\u0631\u062c\u0649 \u0627\u0644\u0625\u062c\u0627\u0628\u0629 \u0642\u0628\u0644 \u0646\u0647\u0627\u064a\u0629 \u064a\u0648\u0645 <date>.',
  },
  C20: {
    en: 'This page has ended.',
    it: 'Questa pagina \u00e8 scaduta.',
    ja: '\u3053\u306e\u30d8\u30fc\u30b8\u306f\u7d42\u4e86\u3057\u307e\u3057\u305f\u3002',
    ar: '\u0627\u0646\u062a\u0647\u062a \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062d\u0629.',
  },
  C21: {
    en: "Couldn't refresh. Trying again.",
    it: 'Aggiornamento non riuscito. Riprovo.',
    ja: '\u66f4\u65b0\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u518d\u8a66\u884c\u3057\u307e\u3059\u3002',
    ar: '\u062a\u0639\u0630\u0631 \u0627\u0644\u062a\u062d\u062f\u064a\u062b. \u0646\u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.',
  },
  C22: { en: 'Working\u2026', it: 'Attendi\u2026', ja: '\u51e6\u7406\u4e2d\u2026', ar: '\u062c\u0627\u0631\u064d \u0627\u0644\u0639\u0645\u0644\u2026' },
  C23: {
    en: 'This field is required.',
    it: 'Questo campo \u00e8 obbligatorio.',
    ja: '\u3053\u306e\u9805\u76ee\u306f\u5fc5\u9808\u3067\u3059\u3002',
    ar: '\u0647\u0630\u0627 \u0627\u0644\u062d\u0642\u0644 \u0645\u0637\u0644\u0648\u0628.',
  },
  C24: { en: 'Announcements', it: 'Annunci', ja: '\u304a\u77e5\u3089\u305b', ar: '\u0627\u0644\u0625\u0639\u0644\u0627\u0646\u0627\u062a' },
  C25: {
    en: 'Refresh state',
    it: 'Stato di aggiornamento',
    ja: '\u66f4\u65b0\u306e\u72b6\u614b',
    ar: '\u062d\u0627\u0644\u0629 \u0627\u0644\u062a\u062d\u062f\u064a\u062b',
  },
  C26: { en: 'Problems', it: 'Problemi', ja: '\u554f\u984c', ar: '\u0627\u0644\u0645\u0634\u0643\u0644\u0627\u062a' },
  C27: { en: 'Before', it: 'Prima', ja: '\u65bd\u5de5\u524d', ar: '\u0642\u0628\u0644' },
  C28: { en: 'After', it: 'Dopo', ja: '\u65bd\u5de5\u5f8c', ar: '\u0628\u0639\u062f' },
  C29: { en: '<n>% before', it: '<n>% prima', ja: '\u65bd\u5de5\u524d <n>%', ar: '<n>% \u0642\u0628\u0644' },
  C30: {
    en: 'Photograph before the work',
    it: 'Foto prima del lavoro',
    ja: '\u65bd\u5de5\u524d\u306e\u5199\u771f',
    ar: '\u0635\u0648\u0631\u0629 \u0642\u0628\u0644 \u0627\u0644\u0639\u0645\u0644',
  },
  C31: {
    en: 'Photograph after the work',
    it: 'Foto dopo il lavoro',
    ja: '\u65bd\u5de5\u5f8c\u306e\u5199\u771f',
    ar: '\u0635\u0648\u0631\u0629 \u0628\u0639\u062f \u0627\u0644\u0639\u0645\u0644',
  },
  C32: {
    en: 'Drawing of the chosen material',
    it: 'Disegno del materiale scelto',
    ja: '\u9078\u3093\u3060\u7d20\u6750\u306e\u56f3',
    ar: '\u0631\u0633\u0645 \u0627\u0644\u0645\u0627\u062f\u0629 \u0627\u0644\u0645\u062e\u062a\u0627\u0631\u0629',
  },
  C33: { en: 'Dye lot', it: 'Partita di tintura', ja: '\u67d3\u8272\u30ed\u30c3\u30c8', ar: '\u062f\u0641\u0639\u0629 \u0627\u0644\u0635\u0628\u063a' },
  C34: { en: 'Material', it: 'Materiale', ja: '\u7d20\u6750', ar: '\u0627\u0644\u0645\u0627\u062f\u0629' },
  C35: { en: 'Labour', it: 'Manodopera', ja: '\u5de5\u8cc3', ar: '\u0627\u0644\u0639\u0645\u0644' },
  C36: { en: 'Subtotal', it: 'Subtotale', ja: '\u5c0f\u8a08', ar: '\u0627\u0644\u0645\u062c\u0645\u0648\u0639 \u0627\u0644\u0641\u0631\u0639\u064a' },
  C37: { en: 'Tax', it: 'Imposta', ja: '\u7a0e', ar: '\u0627\u0644\u0636\u0631\u064a\u0628\u0629' },
  C38: { en: 'Total', it: 'Totale', ja: '\u5408\u8a08', ar: '\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a' },
  C39: { en: 'Stage <n>', it: 'Fase <n>', ja: '\u7b2c<n>\u6bb5\u968e', ar: '\u0627\u0644\u0645\u0631\u062d\u0644\u0629 <n>' },
  C40: {
    en: 'Frame work only, no material',
    it: 'Solo lavoro sul telaio, nessun materiale',
    ja: '\u30d5\u30ec\u30fc\u30e0\u306e\u4f5c\u696d\u306e\u307f\uff08\u7d20\u6750\u306a\u3057\uff09',
    ar: '\u0639\u0645\u0644 \u0639\u0644\u0649 \u0627\u0644\u0647\u064a\u0643\u0644 \u0641\u0642\u0637\u060c \u0628\u0644\u0627 \u0645\u0627\u062f\u0629',
  },
  C41: {
    en: 'No estimate yet.',
    it: 'Ancora nessun preventivo.',
    ja: '\u898b\u7a4d\u3082\u308a\u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093\u3002',
    ar: '\u0644\u0627 \u064a\u0648\u062c\u062f \u062a\u0642\u062f\u064a\u0631 \u0628\u0639\u062f.',
  },
  C42: {
    en: 'Condition notes',
    it: 'Note sullo stato',
    ja: '\u72b6\u614b\u306e\u8a18\u9332',
    ar: '\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u062d\u0627\u0644\u0629',
  },
  C43: { en: 'Tear', it: 'Strappo', ja: '\u88c2\u3051', ar: '\u062a\u0645\u0632\u0642' },
  C44: { en: 'Crack', it: 'Crepa', ja: '\u3072\u3073', ar: '\u0634\u0631\u062e' },
  C45: { en: 'Stain', it: 'Macchia', ja: '\u3057\u307f', ar: '\u0628\u0642\u0639\u0629' },
  C46: { en: 'Loose joint', it: 'Giunto allentato', ja: '\u63a5\u5408\u90e8\u306e\u3086\u308b\u307f', ar: '\u0645\u0641\u0635\u0644 \u0645\u0631\u062e\u064a' },
  C47: { en: 'Woodworm', it: 'Tarlo', ja: '\u866b\u98df\u3044', ar: '\u0633\u0648\u0633 \u0627\u0644\u062e\u0634\u0628' },
  C48: { en: 'Main action', it: 'Azione principale', ja: '\u4e3b\u306a\u64cd\u4f5c', ar: '\u0627\u0644\u0625\u062c\u0631\u0627\u0621 \u0627\u0644\u0631\u0626\u064a\u0633\u064a' },
  C49: { en: 'Loading\u2026', it: 'Caricamento\u2026', ja: '\u8aad\u307f\u8fbc\u307f\u4e2d\u2026', ar: '\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062d\u0645\u064a\u0644\u2026' },
  C50: {
    en: 'No photographs yet.',
    it: 'Ancora nessuna foto.',
    ja: '\u5199\u771f\u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093\u3002',
    ar: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0635\u0648\u0631 \u0628\u0639\u062f.',
  },
  C51: {
    en: 'No condition notes yet.',
    it: 'Ancora nessuna nota sullo stato.',
    ja: '\u72b6\u614b\u306e\u8a18\u9332\u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093\u3002',
    ar: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0644\u0627\u062d\u0638\u0627\u062a \u062d\u0627\u0644\u0629 \u0628\u0639\u062f.',
  },
  C52: {
    en: 'Your answer could not be sent. Try again.',
    it: 'Invio non riuscito. Riprova.',
    ja: '\u56de\u7b54\u3092\u9001\u4fe1\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u3082\u3046\u4e00\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002',
    ar: '\u062a\u0639\u0630\u0631 \u0625\u0631\u0633\u0627\u0644 \u0625\u062c\u0627\u0628\u062a\u0643. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.',
  },
  M1: {
    en: 'Your estimate for <title>',
    it: 'Il preventivo per <title>',
    ja: '<title> \u306e\u304a\u898b\u7a4d\u3082\u308a',
    ar: '\u062a\u0642\u062f\u064a\u0631 <title>',
  },
  M2: {
    en: 'Reminder: your estimate for <title>',
    it: 'Promemoria: il preventivo per <title>',
    ja: '\u30ea\u30de\u30a4\u30f3\u30c0\u30fc: <title> \u306e\u304a\u898b\u7a4d\u3082\u308a',
    ar: '\u062a\u0630\u0643\u064a\u0631: \u062a\u0642\u062f\u064a\u0631 <title>',
  },
  M3: {
    en: 'Dear <name>,',
    it: 'Gentile <name>,',
    ja: '<name> \u69d8',
    ar: '\u0645\u0631\u062d\u0628\u064b\u0627 <name>\u060c',
  },
  M4: {
    en: 'Read it and answer here: <address>',
    it: 'Leggilo e rispondi qui: <address>',
    ja: '\u3053\u3061\u3089\u304b\u3089\u3054\u78ba\u8a8d\u306e\u3046\u3048\u3054\u56de\u7b54\u304f\u3060\u3055\u3044: <address>',
    ar: '\u0627\u0642\u0631\u0623\u0647 \u0648\u0623\u062c\u0628 \u0645\u0646 \u0647\u0646\u0627: <address>',
  },
  K1: { en: 'Care card', it: 'Scheda di cura', ja: '\u304a\u624b\u5165\u308c\u30ab\u30fc\u30c9', ar: '\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0639\u0646\u0627\u064a\u0629' },
  K2: {
    en: 'Keep the piece out of direct sun and away from radiators. Dust it with a soft dry cloth. Ask the conservator before using any cleaner.',
    it: 'Tieni il pezzo lontano dal sole diretto e dai termosifoni. Spolveralo con un panno morbido e asciutto. Chiedi al restauratore prima di usare qualsiasi detergente.',
    ja: '\u76f4\u5c04\u65e5\u5149\u3068\u66d6\u623f\u5668\u5177\u3092\u907f\u3051\u3066\u304f\u3060\u3055\u3044\u3002\u4e7e\u3044\u305f\u67d4\u3089\u304b\u3044\u5e03\u3067\u307b\u3053\u308a\u3092\u6255\u3063\u3066\u304f\u3060\u3055\u3044\u3002\u30af\u30ea\u30fc\u30ca\u30fc\u3092\u4f7f\u3046\u524d\u306b\u4fee\u5fa9\u62c5\u5f53\u8005\u306b\u3054\u76f8\u8ac7\u304f\u3060\u3055\u3044\u3002',
    ar: '\u0623\u0628\u0639\u062f \u0627\u0644\u0642\u0637\u0639\u0629 \u0639\u0646 \u0623\u0634\u0639\u0629 \u0627\u0644\u0634\u0645\u0633 \u0627\u0644\u0645\u0628\u0627\u0634\u0631\u0629 \u0648\u0627\u0644\u0645\u062f\u0627\u0641\u0626. \u0623\u0632\u0644 \u0627\u0644\u063a\u0628\u0627\u0631 \u0628\u0642\u0637\u0639\u0629 \u0642\u0645\u0627\u0634 \u0646\u0627\u0639\u0645\u0629 \u0648\u062c\u0627\u0641\u0629. \u0627\u0633\u062a\u0634\u0631 \u0627\u0644\u0645\u0631\u0645\u0650\u0645 \u0642\u0628\u0644 \u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0623\u064a \u0645\u0646\u0638\u0641.',
  },
};

export function c(id: ClientCopyId, language: Language): string {
  return CLIENT_COPY[id][language];
}

/** Fills `<time>`, `<town>`, `<date>`, `<n>`, `<name>`, `<title>`, `<address>`. */
export function cFill(id: ClientCopyId, language: Language, values: Record<string, string>): string {
  let text = c(id, language);
  for (const [key, value] of Object.entries(values)) {
    text = text.split(`<${key}>`).join(value);
  }
  return text;
}

export const TOWN_NAMES: Record<string, Record<Language, string>> = {
  Turin: { en: 'Turin', it: 'Torino', ja: '\u30c8\u30ea\u30ce', ar: '\u062a\u0648\u0631\u064a\u0646\u0648' },
  London: { en: 'London', it: 'Londra', ja: '\u30ed\u30f3\u30c9\u30f3', ar: '\u0644\u0646\u062f\u0646' },
  'New York': { en: 'New York', it: 'New York', ja: '\u30cb\u30e5\u30fc\u30e8\u30fc\u30af', ar: '\u0646\u064a\u0648\u064a\u0648\u0631\u0643' },
  Kyoto: { en: 'Kyoto', it: 'Kyoto', ja: '\u4eac\u90fd', ar: '\u0643\u064a\u0648\u062a\u0648' },
  Dubai: { en: 'Dubai', it: 'Dubai', ja: '\u30c9\u30d0\u30a4', ar: '\u062f\u0628\u064a' },
};

export const PIN_KIND_COPY: Record<string, ClientCopyId> = {
  tear: 'C43',
  crack: 'C44',
  stain: 'C45',
  looseJoint: 'C46',
  woodworm: 'C47',
};
