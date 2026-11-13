import type { LiveMessage } from '../../shared/types.ts';
import { getJson, sendJson } from '../api.ts';
import { toastRefusal } from '../toastRefusal.ts';
import { LiveChannel, newId, openSocket } from '../store/index.ts';
import type { OpInput } from '../store/index.ts';
import { operationGroup } from '../store/operationGroup.ts';

/** The live messages of a drawing for a screen that does not hold the drawing itself (Review): the revision it saw last, and every message once. */
export class DrawingFeed {
  /** the drawing's revision as of the last `ops` message: the base of a Restore */
  revision: number;
  private readonly listeners = new Set<(message: LiveMessage) => void>();
  private readonly channel: LiveChannel;

  constructor(private readonly drawingId: string, private readonly seq: number, revision: number) {
    this.revision = revision;
    this.channel = new LiveChannel(
      `/api/drawings/${drawingId}/live`,
      openSocket,
      {
        message: (message) => {
          if (message.type === 'ops') this.revision = message.data.revision;
          for (const listener of this.listeners) listener(message);
        },
        resync: () => void toastRefusal(() => this.reload()),
      },
    );
  }

  /** Opens the socket, asking for what happened after the document's `seq`. */
  open(): void {
    this.channel.connect(this.seq);
  }

  subscribe = (listener: (message: LiveMessage) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  close(): void {
    this.channel.disconnect();
  }

  /** Makes one group of `command` through the operations route, on the revision this feed saw last; a refusal throws an `ApiFailure`. */
  submit = async (command: string, ops: readonly OpInput[]): Promise<boolean> => {
    await sendJson('POST', `/api/drawings/${this.drawingId}/ops`, operationGroup(command, ops, this.revision, newId));
    return true;
  };

  private async reload(): Promise<void> {
    const document = await getJson<{ revision: number; seq: number }>(`/api/drawings/${this.drawingId}`);
    this.revision = document.revision;
    this.channel.resynced(document.seq);
  }
}
