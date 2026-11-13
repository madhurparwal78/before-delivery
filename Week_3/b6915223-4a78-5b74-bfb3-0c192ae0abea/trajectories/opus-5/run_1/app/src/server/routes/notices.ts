import type { Handler } from '../http/server.ts';
import { noticesView, readAllNotices } from '../game/notices.ts';

export const getNotices: Handler = async (context) => ({
  status: 200,
  body: await noticesView(context.manager.pb_user_id),
});

export const postReadAll: Handler = async (context) => {
  await readAllNotices(context.manager.pb_user_id);
  return { status: 204 };
};
