// The server's limit values, read once at start.

import { limitsFromEnv, type Limits } from '../shared/limits';

export const limits: Limits = limitsFromEnv(process.env);
