function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : Number(value);
}

export const config = {
  port: whole("APP_PUBLIC_PORT", 4173),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT"),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  undoWindowSeconds: whole("UNDO_WINDOW_SECONDS", 30),
  chatMaxPerMinute: whole("CHAT_MAX_PER_MINUTE", 5),
  partyMaxMembers: whole("PARTY_MAX_MEMBERS", 4),
  questInviteSeconds: whole("QUEST_INVITE_SECONDS", 600),
  gradingToken: process.env.GRADING_TOKEN || undefined,
} as const;
