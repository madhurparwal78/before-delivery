import { copy } from '../../shared/copy';
import { graphemeLength, hasControlCharacters } from '../../shared/text';
import { errors } from '../errors';

/** Display names are trimmed, then 1 to 24 user-perceived characters, with no control characters. */
export function validDisplayName(raw: unknown): string {
  const invalid = errors.invalid({ display_name: copy.displayNameInvalid });
  if (typeof raw !== 'string') throw invalid;
  const name = raw.trim();
  const length = graphemeLength(name);
  if (length < 1 || length > 24 || hasControlCharacters(name)) throw invalid;
  return name;
}
