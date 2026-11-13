import { createContext, useContext } from 'react';

/** The dialogs a screen can open; which one is open is the shell's business, what it contains is the dialog's. */
export type DialogName = 'new-board' | 'settings' | 'shortcuts' | 'password' | 'sheet';

export interface Ui {
  open(name: DialogName): void;
  moveCard(cardId: string): void;
  close(): void;
}

export const UiContext = createContext<Ui | null>(null);

export function useUi(): Ui {
  // Every screen that reads the shell renders inside its provider.
  return useContext(UiContext) as Ui;
}
