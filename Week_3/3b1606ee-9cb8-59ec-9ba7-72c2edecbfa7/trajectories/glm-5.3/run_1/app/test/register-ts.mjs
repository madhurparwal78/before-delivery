// Registers the test-only module hook that maps compiled `.js` specifiers to `.ts` sources.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./ts-hook.mjs', pathToFileURL('./test/'));
