// The rotation plan rule, decided once here. Every boundary is an elapsed-minute offset
// from the booking start; displayed times come from the agency wall clock at that instant.
import { formatTime } from './time.js';
export function buildRotationPlan(input) {
    const { startMs, durationMinutes: D, seatCount, soloThresholdMinutes: T, intervalMinutes: I, holders } = input;
    const entries = [];
    const seat1 = holders.find((h) => h && h.seat === 1) ?? null;
    const seat2 = holders.find((h) => h && h.seat === 2) ?? null;
    const mode = seatCount === 2 ? 'team' : 'solo';
    if (seatCount === 2 && seat1 && seat2) {
        // Alternating plan.
        const N = Math.ceil(D / I);
        for (let i = 0; i < N; i++) {
            const holder = i % 2 === 0 ? seat1 : seat2;
            entries.push({
                index: i,
                kind: 'turn',
                seat: holder.seat,
                holderName: holder.name,
                holderInitials: holder.initials,
                startMinute: i * I,
                endMinute: Math.min((i + 1) * I, D),
                label: null,
            });
        }
        return {
            mode,
            entries,
            coveredMinutes: D,
            percent: 100,
            coverageText: `Team · ${N} turns · 100% covered`,
            turnCount: N,
        };
    }
    // Single-holder plan.
    const held = seat1 ?? seat2;
    if (held) {
        const turnLen = seatCount === 2 ? Math.min(D, T) : D;
        entries.push({
            index: 0,
            kind: 'turn',
            seat: held.seat,
            holderName: held.name,
            holderInitials: held.initials,
            startMinute: 0,
            endMinute: turnLen,
            label: null,
        });
        if (D > turnLen) {
            entries.push({
                index: 1,
                kind: 'gap',
                seat: null,
                holderName: null,
                holderInitials: null,
                startMinute: turnLen,
                endMinute: D,
                label: 'relief needed',
            });
        }
        const covered = turnLen;
        const percent = Math.floor((covered * 100) / D);
        return {
            mode,
            entries,
            coveredMinutes: covered,
            percent,
            coverageText: `${mode === 'team' ? 'Team' : 'Solo'} · ${covered} of ${D} min · ${percent}% covered`,
            turnCount: 1,
        };
    }
    entries.push({
        index: 0,
        kind: 'gap',
        seat: null,
        holderName: null,
        holderInitials: null,
        startMinute: 0,
        endMinute: D,
        label: 'uncovered',
    });
    return {
        mode,
        entries,
        coveredMinutes: 0,
        percent: 0,
        coverageText: `${mode === 'team' ? 'Team' : 'Solo'} · 0 of ${D} min · 0% covered`,
        turnCount: 0,
    };
}
export function entryTimes(startMs, entry) {
    return {
        start: formatTime(startMs + entry.startMinute * 60000),
        end: formatTime(startMs + entry.endMinute * 60000),
    };
}
