// The assignment notice queue: queued in Postgres, sent once, retried while SMTP is down.
import * as q from "../store/queries.js";
import { longDate } from "../domain/calendar.js";
import { readProject } from "./projects.js";
export class NoticeQueue {
    pool;
    mailer;
    config;
    constructor(pool, mailer, config) {
        this.pool = pool;
        this.mailer = mailer;
        this.config = config;
    }
    async queue(assignment) {
        const dueAt = new Date(Date.now() + this.config.assignNoticeDelaySeconds * 1000);
        await q.insertNotice(this.pool, { ...assignment, dueAt });
    }
    async cancel(itemId, userId) {
        await q.cancelNoticesForAssignment(this.pool, itemId, userId);
    }
    async cancelItem(itemId) {
        await q.cancelNoticesForItem(this.pool, itemId);
    }
    /** Send every due notice; called on a short interval. Errors leave the notice queued. */
    async deliverOnce() {
        const due = await q.dueNotices(this.pool, new Date());
        for (const notice of due) {
            try {
                const [assigner, assignee, snapshot] = await Promise.all([
                    q.personById(this.pool, notice.assignerId),
                    q.personById(this.pool, notice.assigneeId),
                    readProject(this.pool, notice.projectId, this.config.today),
                ]);
                if (assigner === null || assignee === null || snapshot === null) {
                    await q.markNoticeSent(this.pool, notice.id);
                    continue;
                }
                const item = snapshot.project.items.find((entry) => entry.id === notice.itemId);
                if (item === undefined) {
                    await q.markNoticeSent(this.pool, notice.id);
                    continue;
                }
                const starts = item.start === null ? '' : longDate(item.start);
                const ends = item.end === null ? '' : longDate(item.end);
                const body = [
                    `${assigner.name} assigned you to ${item.name} in ${snapshot.project.name}.`,
                    `Starts: ${starts}`,
                    `Ends: ${ends}`,
                    `Hours a day: ${notice.hours}`,
                    `Open: ${this.config.publicUrl}/projects/${snapshot.project.id}?task=${item.id}`,
                ].join('\n');
                await this.mailer.send({
                    toName: assignee.name,
                    toEmail: assignee.email,
                    subject: `New assignment: ${item.name} in ${snapshot.project.name}`,
                    body,
                });
                await q.markNoticeSent(this.pool, notice.id);
            }
            catch {
                // SMTP unreachable: the notice stays queued and is retried.
            }
        }
    }
}
