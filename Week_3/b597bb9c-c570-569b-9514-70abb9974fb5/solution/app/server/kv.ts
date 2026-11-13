import { Redis } from "ioredis";
import { config } from "./config";

export const kv = new Redis(config.valkeyUrl, { maxRetriesPerRequest: 2, enableOfflineQueue: true, lazyConnect: false });
kv.on("error", () => undefined);

declare module "ioredis" {
  interface RedisCommander<Context> {
    /** KEYS[1]=counter; ARGV: amount, limit. Returns [taken(0|1), used]; used is -1 when the counter is missing. */
    takeCounter(key: string, amount: number, limit: number): Promise<[number, number]>;
  }
}

kv.defineCommand("takeCounter", {
  numberOfKeys: 1,
  lua: `
    local current = redis.call('GET', KEYS[1])
    if not current then return {0, -1} end
    local used = tonumber(current)
    local amount = tonumber(ARGV[1])
    if used + amount > tonumber(ARGV[2]) then return {0, used} end
    redis.call('INCRBY', KEYS[1], amount)
    return {1, used + amount}
  `,
});
