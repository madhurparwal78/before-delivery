// Sanity test for the race model, run with node after tsc.
import { CARS, LAYOUTS, setupFor, zeroStages } from './domain.js';
import { referenceInputs, runRace, RaceCar } from './raceModel.js';
for (const layoutId of ['saltflat-ring', 'quarry-switchbacks']) {
    const layout = LAYOUTS[layoutId];
    for (const car of CARS) {
        const { stats } = setupFor(car, zeroStages());
        const laps = 1;
        const stepLimit = 7200;
        const events = referenceInputs(layout, stats, laps, stepLimit);
        const out = runRace(layout, stats, laps, stepLimit, false, false, (step) => {
            let last = events[0];
            for (const e of events) {
                if (e.step <= step)
                    last = e;
                else
                    break;
            }
            return { throttle: last.throttle, brake: last.brake, drift: last.drift, lane: last.lane };
        });
        console.log(`${layoutId} ${car.name}: events=${events.length} finished=${out.finished} raceMs=${out.raceMs} sectors=${out.lapResults[0]?.sectorsMs.join(',')} clean=${out.clean} top=${out.topSpeedMps.toFixed(2)}`);
    }
}
// AI driver check: position at step t is reference position at floor(t/factor)
{
    const layout = LAYOUTS['saltflat-ring'];
    const car = CARS[0];
    const { stats } = setupFor(car, zeroStages());
    const ref = new RaceCar(layout, stats, 3, false, false);
    for (let k = 0; k < 7200; k++) {
        const p = ref.referencePedals();
        ref.step(k, p);
    }
    console.log('ref pos after 7200 steps:', ref.position.toFixed(2), 'lap', ref.lap);
}
