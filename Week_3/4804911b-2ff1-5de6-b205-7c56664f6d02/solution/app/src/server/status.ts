// Latest contact result of each provider. Optimistic until the first contact says otherwise.
export const providers = {
  svix: true,
  meili: true,
  storage: true,
  broker: true,
};

/** Every provider call opens its own connection, so a pooled socket can't hide that a provider went away or came back. */
export const FRESH_CONNECTION = { connection: "close" } as const;
