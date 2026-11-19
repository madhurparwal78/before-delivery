// Config, read once at start. Today is the server's, never the browser's.
import { isIsoDate } from "./domain/calendar.js";
function envInt(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '')
        return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}
/** Today in the configured IANA time zone, as a date. */
function zonedToday(timeZone) {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return formatter.format(new Date());
}
export function readConfig() {
    const timeZone = process.env.PLAN_TIME_ZONE || 'UTC';
    const todayEnv = process.env.PLAN_TODAY;
    const today = todayEnv !== undefined && todayEnv !== '' && isIsoDate(todayEnv) ? todayEnv : zonedToday(timeZone);
    const publicPort = envInt('APP_PUBLIC_PORT', 4173);
    return {
        today,
        timeZone,
        assignNoticeDelaySeconds: envInt('ASSIGN_NOTICE_DELAY_SECONDS', 60),
        presenceTimeoutSeconds: envInt('PRESENCE_TIMEOUT_SECONDS', 15),
        knockOnMs: envInt('KNOCK_ON_MS', 220),
        knockOnStaggerMs: envInt('KNOCK_ON_STAGGER_MS', 45),
        finishMotionMs: envInt('FINISH_MOTION_MS', 320),
        gradingKey: process.env.GRADING_KEY && process.env.GRADING_KEY !== '' ? process.env.GRADING_KEY : null,
        publicPort,
        publicUrl: process.env.APP_PUBLIC_URL || `http://localhost:${publicPort}`,
        mailFrom: process.env.MAIL_FROM || 'Slackwater Plan <plans@slackwater.test>',
        bodyLimitBytes: 100_000,
    };
}
