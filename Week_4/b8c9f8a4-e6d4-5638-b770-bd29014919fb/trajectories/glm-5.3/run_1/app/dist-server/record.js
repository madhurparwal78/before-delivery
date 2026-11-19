const MILES_TO_KM = 1.609344;
/**
 * Odometer tape: steps sorted oldest first; NO_ODOMETER and UNREADABLE steps are skipped;
 * a read step lower by more than 1 km than the previous read step flags drop, otherwise a
 * unit change flags unit_change. drop takes priority, and a step can never be both.
 */
export function buildTape(tests) {
    const sorted = [...tests].sort((a, b) => a.completedDate.localeCompare(b.completedDate));
    const steps = [];
    let lastRead = null;
    for (const t of sorted) {
        const base = {
            motTestNumber: t.motTestNumber,
            completedDate: t.completedDate,
            testResult: t.testResult,
            odometerValue: t.odometerValue,
            odometerUnit: t.odometerUnit,
            defects: t.defects,
        };
        if (t.odometerResultType === 'NO_ODOMETER') {
            steps.push({ ...base, status: 'skipped', normalisedKm: null, flag: 'no_odometer' });
            continue;
        }
        if (t.odometerResultType === 'UNREADABLE') {
            steps.push({ ...base, status: 'skipped', normalisedKm: null, flag: 'unreadable' });
            continue;
        }
        const digits = (t.odometerValue ?? '').replace(/\D/g, '');
        const value = digits.length > 0 ? parseInt(digits, 10) : NaN;
        if (t.odometerUnit !== 'MI' && t.odometerUnit !== 'KM' || !Number.isFinite(value)) {
            steps.push({ ...base, status: 'skipped', normalisedKm: null, flag: 'unreadable' });
            continue;
        }
        const normalisedKm = t.odometerUnit === 'MI' ? Math.round(value * MILES_TO_KM * 10) / 10 : value;
        let flag = null;
        if (lastRead) {
            if (normalisedKm < lastRead.normalisedKm - 1)
                flag = 'drop';
            else if (t.odometerUnit !== lastRead.unit)
                flag = 'unit_change';
        }
        steps.push({ ...base, status: 'read', normalisedKm, flag });
        lastRead = { normalisedKm, unit: t.odometerUnit };
    }
    return steps;
}
/** Advisory identity: motTestNumber plus exact text, so responses carry across re-pulls. */
export function advisoryIdentity(motTestNumber, text) {
    return `${motTestNumber}::${text}`;
}
