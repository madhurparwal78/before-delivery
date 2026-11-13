import { one } from "./db.js";
import { insertBrand } from "./domain/brands.js";
import { hashPassword } from "./domain/sessions.js";
const FOUNDER_PASSWORD = "rig-founder-2026";
const BRANDS = [
    { name: "Hollin Audio", currency: "GBP", owner: { name: "Maren Holt", email: "maren@hollin-audio.test" }, finance: "accounts@hollin-audio.test", reviewer: "review@hollin-audio.test", title: "H3 launch stills" },
    { name: "Brant & Vale Kitchen", currency: "EUR", owner: { name: "Joss Brant", email: "joss@brantvale.test" }, finance: "finance@brantvale.test", reviewer: "studio@brantvale.test", title: "Arc kettle colourways" },
    { name: "Ridgeway Cycles", currency: "USD", owner: { name: "Dev Okafor", email: "dev@ridgeway-cycles.test" }, finance: "ap@ridgeway-cycles.test", reviewer: "design@ridgeway-cycles.test", title: "E7 hub motor exploded view" },
    { name: "Sorane Instruments", currency: "JPY", owner: { name: "Aiko Sato", email: "aiko@sorane.test" }, finance: "keiri@sorane.test", reviewer: "design@sorane.test", title: "K-2 grip launch stills" },
];
const RATES = [
    ["EUR", "1.1650"],
    ["USD", "1.2725"],
    ["JPY", "205.4175"],
];
export async function seed(client) {
    await client.query("BEGIN");
    try {
        for (const brand of BRANDS) {
            const present = await one(client, "SELECT 1 FROM contacts WHERE lower(email) = $1", [brand.owner.email]);
            if (!present)
                await insertBrand(client, brand);
        }
        for (const [currency, rate] of RATES) {
            const present = await one(client, "SELECT 1 FROM exchange_rates WHERE currency = $1", [currency]);
            if (!present)
                await client.query("INSERT INTO exchange_rates (currency, rate, effective_at) VALUES ($1, $2, clock_timestamp())", [currency, rate]);
        }
        const founder = await one(client, "SELECT 1 FROM studio_founder WHERE id = 1");
        if (!founder)
            await client.query("INSERT INTO studio_founder (id, password_hash) VALUES (1, $1)", [await hashPassword(FOUNDER_PASSWORD)]);
        await client.query("COMMIT");
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}
