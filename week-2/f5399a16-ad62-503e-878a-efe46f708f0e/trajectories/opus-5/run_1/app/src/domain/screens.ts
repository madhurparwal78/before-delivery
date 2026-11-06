/** Every screen's level-one heading and the page title it makes. */
export type ScreenName =
  | 'home'
  | 'reel'
  | 'howItWorks'
  | 'signIn'
  | 'signUp'
  | 'jobs'
  | 'clients'
  | 'client'
  | 'calls'
  | 'job'
  | 'script'
  | 'jobReel'
  | 'lines'
  | 'cues'
  | 'cuts'
  | 'compare'
  | 'notes'
  | 'delivery'
  | 'letter'
  | 'review'
  | 'signOff'
  | 'fee'
  | 'notFound';

export type ScreenMatch = {
  name: ScreenName;
  /** The heading when it needs no data, split into the lines that reveal. */
  headingLines: string[] | null;
  jobId?: string;
  clientId?: string;
  token?: string;
};

export function pageTitle(heading: string): string {
  return `${heading} — Clapstick`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function matchScreen(path: string): ScreenMatch {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home', headingLines: ['Boards drawn', 'to the frame'] };
  if (parts.length === 1) {
    switch (parts[0]) {
      case 'reel':
        return { name: 'reel', headingLines: ['Work on the reel'] };
      case 'how-it-works':
        return { name: 'howItWorks', headingLines: ['How the work runs'] };
      case 'sign-in':
        return { name: 'signIn', headingLines: ['Sign in'] };
      case 'sign-up':
        return { name: 'signUp', headingLines: ['Start a desk'] };
      default:
        return notFound();
    }
  }
  if (parts[0] === 'r' && parts.length === 2) {
    return { name: 'review', headingLines: null, token: parts[1] as string };
  }
  if (parts[0] === 's' && parts.length === 2) {
    return { name: 'signOff', headingLines: null, token: parts[1] as string };
  }
  if (parts[0] === 'f' && parts.length === 2) {
    return { name: 'fee', headingLines: null, token: parts[1] as string };
  }
  if (parts[0] !== 'desk') return notFound();
  if (parts.length === 2) {
    switch (parts[1]) {
      case 'jobs':
        return { name: 'jobs', headingLines: ['Jobs'] };
      case 'clients':
        return { name: 'clients', headingLines: ['Clients'] };
      case 'calls':
        return { name: 'calls', headingLines: ['Calls'] };
      default:
        return notFound();
    }
  }
  if (parts[1] === 'clients' && parts.length === 3 && UUID.test(parts[2] as string)) {
    return { name: 'client', headingLines: null, clientId: parts[2] as string };
  }
  if (parts[1] !== 'jobs' || !UUID.test(parts[2] as string)) return notFound();
  const jobId = parts[2] as string;
  if (parts.length === 3) return { name: 'job', headingLines: null, jobId };
  if (parts.length !== 4) return notFound();
  const screens: Record<string, ScreenName> = {
    script: 'script',
    reel: 'jobReel',
    lines: 'lines',
    cues: 'cues',
    cuts: 'cuts',
    compare: 'compare',
    notes: 'notes',
    delivery: 'delivery',
    letter: 'letter',
  };
  const name = screens[parts[3] as string];
  return name === undefined ? notFound() : { name, headingLines: null, jobId };
}

function notFound(): ScreenMatch {
  return { name: 'notFound', headingLines: ['Page not found'] };
}

export const SIGNED_IN_SCREENS: readonly ScreenName[] = [
  'jobs',
  'clients',
  'client',
  'calls',
  'job',
  'script',
  'jobReel',
  'lines',
  'cues',
  'cuts',
  'compare',
  'notes',
  'delivery',
  'letter',
];

export const PUBLIC_SCREENS: readonly ScreenName[] = [
  'home',
  'reel',
  'howItWorks',
  'signIn',
  'signUp',
  'notFound',
];
