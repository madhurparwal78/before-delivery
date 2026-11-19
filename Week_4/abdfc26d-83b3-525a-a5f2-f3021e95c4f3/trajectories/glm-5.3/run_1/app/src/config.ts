const int = (raw: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export class Config {
  readonly databaseUrl: string;
  readonly keycloakUrl: string;
  readonly keycloakRealm: string;
  readonly authIssuerUrl: string;
  readonly authClientId: string;
  readonly authClientSecret: string;
  readonly killbillUrl: string;
  readonly killbillUsername: string;
  readonly killbillPassword: string;
  readonly killbillApiKey: string;
  readonly killbillApiSecret: string;
  readonly s3Endpoint: string;
  readonly s3Region: string;
  readonly s3Bucket: string;
  readonly s3ForcePathStyle: boolean;
  readonly s3AccessKeyId: string;
  readonly s3SecretAccessKey: string;
  readonly amqpUrl: string;
  readonly wiremockUrl: string;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly mailFrom: string;
  readonly gotenbergUrl: string;
  readonly appPublicUrl: string;
  readonly appPublicPort: number;
  readonly holdSeconds: number;
  readonly providerTimeoutSeconds: number;
  readonly renderBackoffSeconds: number;
  readonly refundWindowSeconds: number;
  readonly idempotencyTtlSeconds: number;
  readonly presignSeconds: number;
  readonly renderQueue: string;

  constructor(env: NodeJS.ProcessEnv) {
    this.databaseUrl = env.DATABASE_URL ?? '';
    this.keycloakUrl = env.KEYCLOAK_URL ?? 'http://localhost:8080';
    this.keycloakRealm = env.KEYCLOAK_REALM ?? 'phosphene';
    this.authIssuerUrl = env.AUTH_ISSUER_URL ?? '';
    this.authClientId = env.AUTH_CLIENT_ID ?? 'phosphene-yard';
    this.authClientSecret = env.AUTH_CLIENT_SECRET ?? '';
    this.killbillUrl = (env.KILLBILL_URL ?? 'http://localhost:8081').replace(/\/$/, '');
    this.killbillUsername = env.KILLBILL_USERNAME ?? 'admin';
    this.killbillPassword = env.KILLBILL_PASSWORD ?? 'password';
    this.killbillApiKey = env.KILLBILL_API_KEY ?? 'phosphene';
    this.killbillApiSecret = env.KILLBILL_API_SECRET ?? 'phosphene';
    this.s3Endpoint = (env.S3_ENDPOINT ?? 'http://localhost:9000').replace(/\/$/, '');
    this.s3Region = env.S3_REGION ?? 'us-east-1';
    this.s3Bucket = env.S3_BUCKET ?? 'phosphene';
    this.s3ForcePathStyle = env.S3_FORCE_PATH_STYLE !== 'false';
    this.s3AccessKeyId = env.S3_ACCESS_KEY_ID ?? '';
    this.s3SecretAccessKey = env.S3_SECRET_ACCESS_KEY ?? '';
    this.amqpUrl = env.AMQP_URL ?? 'amqp://localhost:5672';
    this.wiremockUrl = (env.WIREMOCK_URL ?? 'http://localhost:9090').replace(/\/$/, '');
    this.smtpHost = env.SMTP_HOST ?? 'localhost';
    this.smtpPort = int(env.SMTP_PORT, 1025);
    this.mailFrom = env.MAIL_FROM ?? 'Phosphene Yard <studio@brightmoss.example>';
    this.gotenbergUrl = (env.GOTENBERG_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    this.appPublicUrl = (env.APP_PUBLIC_URL ?? 'http://localhost:4173').replace(/\/$/, '');
    this.appPublicPort = int(env.APP_PUBLIC_PORT, 4173);
    this.holdSeconds = int(env.HOLD_SECONDS, 600);
    this.providerTimeoutSeconds = int(env.PROVIDER_TIMEOUT_SECONDS, 120);
    this.renderBackoffSeconds = int(env.RENDER_BACKOFF_SECONDS, 5);
    this.refundWindowSeconds = int(env.REFUND_WINDOW_SECONDS, 2592000);
    this.idempotencyTtlSeconds = int(env.IDEMPOTENCY_TTL_SECONDS, 86400);
    this.presignSeconds = int(env.PRESIGN_SECONDS, 300);
    this.renderQueue = env.RENDER_QUEUE ?? 'render.jobs';
  }
}

export const config = new Config(process.env);
