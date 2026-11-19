// A message published on a layout's channel and pushed to every open page.
export type LiveKind = 'change' | 'presence';

export interface LiveMessage {
  layoutId: string;
  kind: LiveKind;
  revision: number;
  username: string;
  announcement: string | null;
  layout?: unknown;
  usernames?: string[];
}
