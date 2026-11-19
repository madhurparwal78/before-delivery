import { publishServices } from '../events';
import { postgresReachable } from '../db';
import { mailReachable } from './mail';
import { pdfReachable } from './pdf';

export interface ServiceState {
  mail: boolean;
  pdf: boolean;
  postgres: boolean;
}

const state: ServiceState = { mail: true, pdf: true, postgres: true };

export function serviceState(): ServiceState {
  return { ...state };
}

export function outages(): { mail: boolean; pdf: boolean } {
  return { mail: state.mail, pdf: state.pdf };
}

/** Re-reads reachability and pushes any change to open screens. */
export async function checkServices(): Promise<ServiceState> {
  const [mail, pdf, postgres] = await Promise.all([
    mailReachable(),
    pdfReachable(),
    postgresReachable(),
  ]);
  const changed = mail !== state.mail || pdf !== state.pdf;
  state.mail = mail;
  state.pdf = pdf;
  state.postgres = postgres;
  if (changed) publishServices({ mail, pdf });
  return serviceState();
}
