import type { Handler } from '../http/server.ts';
import { downloadSnapshot, historyView, ledgerView, transferHistory } from '../game/history.ts';

export const getHistory: Handler = async (context) => ({
  status: 200,
  body: await historyView(context.manager.id),
});

export const getTransferHistory: Handler = async (context) => ({
  status: 200,
  body: { transfers: await transferHistory(context.manager.id) },
});

export const getLedger: Handler = async (context) => ({
  status: 200,
  body: await ledgerView(context.manager.id),
});

export const snapshotResponse = async (
  managerId: string,
  gameweek: number,
): Promise<{ status: number; bytes: Buffer; headers: Record<string, string> }> => {
  const snapshot = await downloadSnapshot(managerId, gameweek);
  return {
    status: 200,
    bytes: snapshot.bytes,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${snapshot.filename}"`,
    },
  };
};

export const getSnapshot: Handler = (context) =>
  snapshotResponse(context.manager.id, Number(context.params.gameweek));
