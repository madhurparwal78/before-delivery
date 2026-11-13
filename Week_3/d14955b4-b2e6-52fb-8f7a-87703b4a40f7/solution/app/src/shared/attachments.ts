export const FILE_LIMIT_BYTES = 5_000_000;
export const FILES_PER_MESSAGE = 3;
export const ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'text/plain'] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
