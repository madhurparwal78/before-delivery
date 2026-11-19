export type ServiceName = 'valkey' | 'minio';

const forcedDown: Record<ServiceName, boolean> = { valkey: false, minio: false };

export function setForcedDown(service: ServiceName, down: boolean): void {
  forcedDown[service] = down;
}

export function isForcedDown(service: ServiceName): boolean {
  return forcedDown[service];
}
