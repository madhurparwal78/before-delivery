import { buildRoute } from '../domain/route.js';
import { newId } from '../services/ids.js';
import { parseBrusselsLocal } from '../domain/time.js';
function mustRoute(spec) {
    if (!spec)
        throw new Error('seed route invalid');
    return spec;
}
import { generatedPng } from '../services/png.js';
export async function seed(db, cfg, clock, s3) {
    const existing = await db.query('SELECT COUNT(*)::int AS n FROM members');
    if (Number(existing.rows[0].n) > 0)
        return;
    const now = clock.nowMs();
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const ids = new Map();
        const members = [
            { key: 'founder', email: 'founder@longseat.test', name: 'Wren Halloway', roles: ['founder'], idState: 'verified', wallet: 0 },
            { key: 'mara', email: 'mara@longseat.test', name: 'Mara Quell', roles: ['driver', 'passenger'], idState: 'verified', wallet: 0 },
            { key: 'idris', email: 'idris@longseat.test', name: 'Idris Penhallow', roles: ['driver', 'passenger'], idState: 'verified', wallet: 0 },
            { key: 'lune', email: 'lune@longseat.test', name: 'Lune Ostrander', roles: ['passenger'], idState: 'none', wallet: 6000 },
            { key: 'tobin', email: 'tobin@longseat.test', name: 'Tobin Areck', roles: ['passenger'], idState: 'none', wallet: 4000 },
        ];
        for (const m of members) {
            const id = newId();
            ids.set(m.key, id);
            await client.query(`INSERT INTO members (id, email, display_name, roles, id_state, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [id, m.email, m.name, m.roles, m.idState, now]);
            if (m.wallet > 0) {
                const entryId = newId();
                await client.query('INSERT INTO ledger_entries (id, kind, booking_id, at) VALUES ($1,$2,NULL,$3)', [entryId, 'topup', now]);
                await client.query('INSERT INTO ledger_lines (entry_id, account, amount_cents) VALUES ($1,$2,$3)', [entryId, `wallet:${id}`, m.wallet]);
                await client.query('INSERT INTO ledger_lines (entry_id, account, amount_cents) VALUES ($1,$2,$3)', [entryId, 'network:topups', -m.wallet]);
            }
        }
        const carMara = newId();
        await client.query('INSERT INTO vehicles (id, owner_id, make_model, colour, seats) VALUES ($1,$2,$3,$4,$5)', [carMara, ids.get('mara'), 'Rowan Estate', 'Slate grey', 3]);
        const carIdris = newId();
        await client.query('INSERT INTO vehicles (id, owner_id, make_model, colour, seats) VALUES ($1,$2,$3,$4,$5)', [carIdris, ids.get('idris'), 'Fenwick Compact', 'Moss green', 4]);
        const ride1 = newId();
        const stops1 = ['Kestrevel', 'Brisanne', 'Oakhythe', 'Tollemarch'];
        const dep1 = parseBrusselsLocal('2027-01-16T08:30');
        const spec1 = mustRoute(buildRoute(stops1, dep1, cfg));
        await client.query(`INSERT INTO rides (id, driver_id, vehicle_id, state, version, booking_mode, seats, price_cents, route_km, departure, arrival, created_at)
       VALUES ($1,$2,$3,'published',1,'instant',3,2150,$4,$5,$6,$7)`, [ride1, ids.get('mara'), carMara, spec1.routeKm, dep1, spec1.stops[spec1.stops.length - 1].time, now]);
        for (let i = 0; i < spec1.stops.length; i++) {
            await client.query('INSERT INTO ride_stops (ride_id, idx, city, km, time) VALUES ($1,$2,$3,$4,$5)', [ride1, i, spec1.stops[i].city, spec1.stops[i].km, spec1.stops[i].time]);
        }
        const ride2 = newId();
        const stops2 = ['Vardholm', 'Kestrevel', 'Hesketh Mere'];
        const dep2 = parseBrusselsLocal('2027-01-16T14:00');
        const spec2 = mustRoute(buildRoute(stops2, dep2, cfg));
        await client.query(`INSERT INTO rides (id, driver_id, vehicle_id, state, version, booking_mode, seats, price_cents, route_km, departure, arrival, created_at)
       VALUES ($1,$2,$3,'published',1,'request',4,1500,$4,$5,$6,$7)`, [ride2, ids.get('idris'), carIdris, spec2.routeKm, dep2, spec2.stops[spec2.stops.length - 1].time, now]);
        for (let i = 0; i < spec2.stops.length; i++) {
            await client.query('INSERT INTO ride_stops (ride_id, idx, city, km, time) VALUES ($1,$2,$3,$4,$5)', [ride2, i, spec2.stops[i].city, spec2.stops[i].km, spec2.stops[i].time]);
        }
        const ride3 = newId();
        const stops3 = ['Tollemarch', 'Corrandy', 'Saint Ivrel'];
        const dep3 = parseBrusselsLocal('2027-01-17T17:15');
        const spec3 = mustRoute(buildRoute(stops3, dep3, cfg));
        await client.query(`INSERT INTO rides (id, driver_id, vehicle_id, state, version, booking_mode, seats, price_cents, route_km, departure, arrival, created_at)
       VALUES ($1,$2,$3,'published',1,'instant',3,2000,$4,$5,$6,$7)`, [ride3, ids.get('mara'), carMara, spec3.routeKm, dep3, spec3.stops[spec3.stops.length - 1].time, now]);
        for (let i = 0; i < spec3.stops.length; i++) {
            await client.query('INSERT INTO ride_stops (ride_id, idx, city, km, time) VALUES ($1,$2,$3,$4,$5)', [ride3, i, spec3.stops[i].city, spec3.stops[i].km, spec3.stops[i].time]);
        }
        // Lune's confirmed booking on ride 1, Kestrevel → Brisanne, seat 1, €6.76
        const b1 = newId();
        const segKm = spec1.stops[1].km - spec1.stops[0].km;
        const segPrice = Math.floor((2150 * segKm) / spec1.routeKm);
        await client.query(`INSERT INTO bookings (id, ride_id, passenger_id, boarding, alighting, boarding_time, alighting_time, seats, seat_numbers, segment_km, price_cents, state, created_at, ride_version)
       VALUES ($1,$2,$3,'Kestrevel','Brisanne',$4,$5,1,ARRAY[1],$6,$7,'confirmed',$8,1)`, [b1, ride1, ids.get('lune'), spec1.stops[0].time, spec1.stops[1].time, segKm, segPrice, now]);
        await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [b1, 'confirmed', now]);
        await client.query('INSERT INTO ledger_entries (id, kind, booking_id, at) VALUES ($1,$2,$3,$4)', [newId(), 'payment', b1, now]);
        const payEntry = await client.query('SELECT id FROM ledger_entries WHERE booking_id = $1', [b1]);
        await client.query('INSERT INTO ledger_lines (entry_id, account, amount_cents) VALUES ($1,$2,$3)', [payEntry.rows[0].id, `wallet:${ids.get('lune')}`, -segPrice]);
        await client.query('INSERT INTO ledger_lines (entry_id, account, amount_cents) VALUES ($1,$2,$3)', [payEntry.rows[0].id, `held:${b1}`, segPrice]);
        await client.query('COMMIT');
        client.release();
    }
    catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
        throw e;
    }
    void s3;
    void generatedPng;
}
