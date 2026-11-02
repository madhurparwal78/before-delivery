import { probeDb } from "./db.js";
import { probeFiles } from "./files.js";
import { probeKillBill } from "./killbill.js";
import { probeMail } from "./mail.js";
import { probePocketBase } from "./pocketbase.js";
const PROBES = {
    killbill: probeKillBill,
    postgres: probeDb,
    pocketbase: probePocketBase,
    minio: probeFiles,
    mailpit: probeMail,
};
const status = {
    killbill: "down",
    postgres: "down",
    pocketbase: "down",
    minio: "down",
    mailpit: "down",
};
export async function refreshStatus() {
    await Promise.all(Object.keys(PROBES).map(async (service) => {
        status[service] = (await PROBES[service]()) ? "up" : "down";
    }));
}
export const serviceStatus = () => ({ ...status });
export const isUp = (service) => status[service] === "up";
