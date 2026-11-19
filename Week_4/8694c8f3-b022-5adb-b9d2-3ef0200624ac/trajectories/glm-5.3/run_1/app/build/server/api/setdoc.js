import { defaultLayer, STARTER_SHADER } from '../layers.js';
import { sha256Hex } from '../crypto.js';
export const sha256Starter = sha256Hex(Buffer.from(STARTER_SHADER, 'utf8'));
export { defaultLayer };
