/** UTC text as the API writes times: `YYYY-MM-DDTHH:MM:SSZ`. */
export const utcText = (date: Date): string => date.toISOString().slice(0, 19) + "Z";
