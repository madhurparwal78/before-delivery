import { restoredVersion } from '../../shared/copy.ts';
import type { VersionSummary } from '../../shared/types.ts';
import type { OpInput } from '../store/index.ts';
import { announce } from '../ui/index.ts';

/** Makes one group of a command; true when the drawing applied it. The live store and the Review feed each make groups their own way. */
type SubmitGroup = (command: string, ops: readonly OpInput[]) => Promise<boolean>;

/** Restore this version: one `RESTORE` group with a `version_restore` operation, announced once the drawing applied it. */
export async function restoreVersion(submit: SubmitGroup, version: Pick<VersionSummary, 'id' | 'number'>): Promise<void> {
  if (await submit('RESTORE', [{ type: 'version_restore', version: version.id }])) announce(restoredVersion(version.number));
}
