import multer from 'multer';
import { CONFIG } from './config.js';

const memory = multer.memoryStorage();

/** Uploads are bounded at the published limit plus overhead. */
export const upload = multer({
  storage: memory,
  limits: { fileSize: CONFIG.uploadMaxBytes, files: 1, fields: 20 },
});
