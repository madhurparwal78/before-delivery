// Every service address and credential, read once from the environment at start.

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const optionalDate = (name: string): string | null => {
  const value = process.env[name];
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be YYYY-MM-DD`);
  return value;
};

const cycleSeconds = (): number | null => {
  const raw = process.env.PROMPTSIDE_CYCLE_SECONDS;
  if (!raw) return null;
  const seconds = Number(raw);
  if (!/^\d+$/.test(raw) || seconds < 10 || seconds > 604_800) {
    throw new Error("PROMPTSIDE_CYCLE_SECONDS must be a whole number from 10 to 604800");
  }
  return seconds;
};

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT || 4173),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    pathStyle: required("S3_FORCE_PATH_STYLE").toLowerCase() !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  pocketbase: {
    url: required("POCKETBASE_URL").replace(/\/+$/, ""),
    email: required("POCKETBASE_ADMIN_EMAIL"),
    password: required("POCKETBASE_ADMIN_PASSWORD"),
  },
  timeZone: process.env.THEATRE_TZ || "Europe/London",
  firstMonday: optionalDate("PROMPTSIDE_FIRST_MONDAY"),
  openingNight: optionalDate("PROMPTSIDE_OPENING_NIGHT"),
  cycleSeconds: cycleSeconds(),
};
