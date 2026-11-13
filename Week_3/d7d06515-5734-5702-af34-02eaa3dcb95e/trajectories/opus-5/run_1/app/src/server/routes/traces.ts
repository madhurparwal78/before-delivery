import { copy } from '../../shared/copy';
import { assertOwner, assertTraceWrite, resolveDrawingCaller } from '../access';
import { findUserById } from '../accounts';
import { fail, ValidationError } from '../errors';
import { sendTraceSubmittedEmail } from '../emails';
import { MailUnavailable } from '../mail';
import { publishDrawing } from '../live';
import {
  assertTraceAuthor,
  assertTraceOpen,
  assertTraceSubmitted,
  closeTrace,
  createTrace,
  findTrace,
  isTraceCommand,
  listIssues,
  resolveIssue,
  runTraceCommand,
  serializeTrace,
  setTraceNotice,
  submitTrace,
} from '../traces';
import { json, type Router } from '../http';

export function registerTraceRoutes(router: Router): void {
  router.add('POST', '/api/drawings/:id/traces', async (context) => {
    const caller = await resolveDrawingCaller(context, context.params.id!);
    const body = await context.json();
    assertTraceWrite(caller);
    const trace = await createTrace({
      drawingId: caller.drawing.id,
      name: typeof body.name === 'string' ? body.name : '',
      author: caller.actor.name,
      authorKey: caller.actor.key,
      now: caller.now,
    });
    await publishDrawing(caller.drawing.id, { type: 'trace', trace: { id: trace.id, state: trace.state } });
    return json(201, {
      trace: { id: trace.id, name: trace.name, state: trace.state, author: trace.author, objects: [] },
    });
  });

  router.add('GET', '/api/traces/:id', async (context) => {
    const trace = await findTrace(context.params.id!);
    if (trace === null) fail('not_found');
    const caller = await resolveDrawingCaller(context, trace.drawing_id);
    return json(200, { trace: await serializeTrace(trace, caller.drawing.units) });
  });

  router.add('POST', '/api/traces/:id/commands', async (context) => {
    const trace = await findTrace(context.params.id!);
    if (trace === null) fail('not_found');
    const caller = await resolveDrawingCaller(context, trace.drawing_id);
    const body = await context.json();
    assertTraceWrite(caller);
    assertTraceAuthor(trace, caller.actor.key);
    assertTraceOpen(trace);
    if (!isTraceCommand(body.command)) throw new ValidationError({ command: 'Unknown command.' });
    await runTraceCommand(trace, body.command, body.args ?? {});
    await publishDrawing(caller.drawing.id, { type: 'trace', trace: { id: trace.id, state: trace.state } });
    return json(200, { trace: await serializeTrace(trace, caller.drawing.units) });
  });

  router.add('POST', '/api/traces/:id/submit', async (context) => {
    const trace = await findTrace(context.params.id!);
    if (trace === null) fail('not_found');
    const caller = await resolveDrawingCaller(context, trace.drawing_id);
    assertTraceWrite(caller);
    assertTraceAuthor(trace, caller.actor.key);
    assertTraceOpen(trace);
    const issueCount = await submitTrace(trace, caller.now);

    let notice: 'sent' | 'not_sent' = 'not_sent';
    const owner = caller.drawing.owner_user_id === null ? null : await findUserById(caller.drawing.owner_user_id);
    if (owner !== null) {
      try {
        await sendTraceSubmittedEmail({
          to: owner.email,
          traceName: trace.name,
          drawingName: caller.drawing.name,
          reviewerName: trace.author,
          issueCount,
        });
        notice = 'sent';
      } catch (error) {
        if (!(error instanceof MailUnavailable)) throw error;
      }
    }
    await setTraceNotice(trace.id, notice);
    await publishDrawing(caller.drawing.id, {
      type: 'trace',
      trace: {
        id: trace.id,
        name: trace.name,
        state: 'submitted',
        author: trace.author,
        notice,
        announcement: copy.announce.traceSubmitted(trace.name, trace.author),
      },
    });
    await publishDrawing(caller.drawing.id, { type: 'issues', issues: await listIssues(caller.drawing.id) });
    return json(200, { trace: { state: 'submitted', notice } });
  });

  router.add('POST', '/api/traces/:id/close', async (context) => {
    const trace = await findTrace(context.params.id!);
    if (trace === null) fail('not_found');
    const caller = await resolveDrawingCaller(context, trace.drawing_id);
    assertOwner(caller);
    assertTraceSubmitted(trace);
    await closeTrace(trace.id);
    await publishDrawing(caller.drawing.id, { type: 'trace', trace: { id: trace.id, state: 'closed' } });
    return json(200, { trace: { state: 'closed' } });
  });

  router.add('GET', '/api/drawings/:id/issues', async (context) => {
    const caller = await resolveDrawingCaller(context, context.params.id!);
    return json(200, { issues: await listIssues(caller.drawing.id) });
  });

  router.add('POST', '/api/drawings/:id/issues/:number/resolve', async (context) => {
    const caller = await resolveDrawingCaller(context, context.params.id!);
    assertOwner(caller);
    const number = Number.parseInt(context.params.number!, 10);
    const issue = await resolveIssue(caller.drawing.id, number);
    await publishDrawing(caller.drawing.id, { type: 'issues', issues: await listIssues(caller.drawing.id) });
    return json(200, { issue });
  });
}

