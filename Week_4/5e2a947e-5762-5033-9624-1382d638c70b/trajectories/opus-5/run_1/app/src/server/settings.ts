import { readSettings, readPort } from '../shared/settings.js';

export const settings = readSettings(process.env);
export const port = readPort(process.env);
