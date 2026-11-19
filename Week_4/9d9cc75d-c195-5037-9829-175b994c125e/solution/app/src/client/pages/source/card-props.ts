import type { Source } from '../../../shared/model.ts';

export interface CardProps {
  source: Source;
  /** the project the source belongs to */
  project: string;
  /** only creators edit; explorers read */
  creator: boolean;
  /** Reads the source again, so every card shows what the server now holds. */
  reload: () => Promise<void>;
  /** Writes a confirmation to `status "Announcements"`. */
  say: (text: string) => void;
  /** Writes a refusal or failure to `status "Announcements"`. */
  warn: (text: string) => void;
}
