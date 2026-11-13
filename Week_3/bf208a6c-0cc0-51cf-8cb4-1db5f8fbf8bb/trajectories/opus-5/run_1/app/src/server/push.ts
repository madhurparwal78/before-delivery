import { env } from './env';

const authHeader = (): string =>
  `Basic ${Buffer.from(`${env.ntfy.username}:${env.ntfy.password}`, 'utf8').toString('base64')}`;

const approvalTopic = (boardId: string): string => `pinsheet-approvals-${boardId}`;

/** A held post sends one message naming only the board and the post title. */
export const publishApprovalPush = async (boardId: string, boardTitle: string, postTitle: string): Promise<boolean> => {
  try {
    const response = await fetch(`${env.ntfy.url.replace(/\/+$/, '')}/${approvalTopic(boardId)}`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        Title: `Post waiting on ${boardTitle}`,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: postTitle,
      signal: AbortSignal.timeout(10000),
    });
    await response.arrayBuffer();
    return response.status === 200;
  } catch {
    return false;
  }
};

export const checkPush = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${env.ntfy.url.replace(/\/+$/, '')}/v1/health`, {
      headers: { Authorization: authHeader() },
      signal: AbortSignal.timeout(10000),
    });
    if (response.status !== 200) {
      await response.arrayBuffer();
      return false;
    }
    const body = (await response.json()) as { healthy?: boolean };
    return body.healthy === true;
  } catch {
    return false;
  }
};
