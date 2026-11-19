/** Slots the project page fills in when it mounts, so views and dialogs need not import it. */
export const bus = {
  update: (): void => {},
  announceSchedule: (_text: string): void => {},
  announceProject: (_text: string): void => {},
  announceExport: (_text: string): void => {},
  setAlert: (_text: string | null): void => {},
  reloadWorkload: (): void => {},
};
