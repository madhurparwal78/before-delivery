import { Ctx } from '../http/context';

export function declineReason(ctx: Ctx): string {
  return ctx.text('reason', 'Give a reason in 1 to 200 characters.', { min: 1, max: 200, multiline: true });
}
