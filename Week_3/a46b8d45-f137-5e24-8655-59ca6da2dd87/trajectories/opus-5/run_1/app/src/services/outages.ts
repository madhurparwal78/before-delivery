/**
 * One error per service outage. No failure is remembered: each request tries its service
 * again, so the first request after a service returns succeeds without a restart.
 */

export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super('file storage unavailable');
    this.name = 'StorageUnavailable';
    this.cause = cause;
  }
}

export class BillingUnavailable extends Error {
  constructor(cause?: unknown) {
    super('billing unavailable');
    this.name = 'BillingUnavailable';
    this.cause = cause;
  }
}

export class MailUnavailable extends Error {
  constructor(cause?: unknown) {
    super('mail unavailable');
    this.name = 'MailUnavailable';
    this.cause = cause;
  }
}

/** How a carrier answer was sorted: slow, failing or malformed. */
export type CarrierFault = 'carrier_timeout' | 'carrier_unavailable' | 'carrier_malformed';

export class CarrierFailure extends Error {
  constructor(readonly fault: CarrierFault, cause?: unknown) {
    super(fault);
    this.name = 'CarrierFailure';
    this.cause = cause;
  }
}
