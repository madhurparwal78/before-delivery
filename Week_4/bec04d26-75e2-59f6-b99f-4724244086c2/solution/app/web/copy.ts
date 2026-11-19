export const MAIL_BANNER = "Reminders are waiting: mail can't be reached right now.";
export const PDF_BANNER = "Packets are waiting: the PDF service can't be reached right now.";
export const SERVER_ERROR = "That didn't save. Try again.";
export const NOT_FOUND_HEADING = "Return not found";
export const NOT_FOUND_TEXT = "This return doesn't exist, or you don't have access to it.";
export const DEADLINE_PASSED = "The deadline for this return has passed.";

export const conflictLine = (changedBy: string, statusLabel: string): string =>
  `${changedBy} changed this return first. It is now ${statusLabel}.`;
