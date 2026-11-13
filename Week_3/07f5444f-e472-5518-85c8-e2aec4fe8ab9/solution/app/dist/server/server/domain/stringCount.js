// String count limits: each section a whole number from 0 to the players on its roster.
import { SECTION_KEYS, SECTION_NAMES } from "../../shared/api.js";
import { field, isWholeNumber } from "../validate.js";
export function checkStringCount(value, roster) {
    const errors = {};
    const count = { violin_1: 0, violin_2: 0, viola: 0, cello: 0, bass: 0 };
    for (const section of SECTION_KEYS) {
        const players = field(value, section);
        if (isWholeNumber(players) && players > roster[section]) {
            errors[section] = `The roster has ${roster[section]} players in ${SECTION_NAMES[section]}.`;
        }
        else if (!isWholeNumber(players) || players < 0) {
            errors[section] = `Enter a whole number from 0 to ${roster[section]}.`;
        }
        else {
            count[section] = players;
        }
    }
    return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, count };
}
