import { seedAudio } from './domain/audio.js';
import type { Plan, Role } from '../shared/types.js';

export const SEED_PASSWORD = 'lowfield-demo-2026';

export interface SeedMember {
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly projects: readonly string[] | 'all';
}

export interface SeedProject {
  readonly name: string;
  readonly quotaMinutes: number;
  readonly keySecret: string;
  readonly keyName: string;
}

export interface SeedOrg {
  readonly name: string;
  readonly slug: string;
  readonly plan: Plan;
  readonly projects: readonly SeedProject[];
  readonly members: readonly SeedMember[];
}

export const seedOrgs: readonly SeedOrg[] = [
  {
    name: 'Harbourline Health',
    slug: 'harbourline',
    plan: 'pilot',
    projects: [
      {
        name: 'Ward Dictation',
        quotaMinutes: 600,
        keySecret: 'lf_live_00000000000000000000000000000a01',
        keyName: 'Seed ward key',
      },
      {
        name: 'Clinic Intake',
        quotaMinutes: 120,
        keySecret: 'lf_live_00000000000000000000000000000a02',
        keyName: 'Seed intake key',
      },
    ],
    members: [
      { name: 'Ines Okafor', email: 'ines.okafor@harbourline.example', role: 'admin', projects: 'all' },
      {
        name: 'Teo Marlow',
        email: 'teo.marlow@harbourline.example',
        role: 'developer',
        projects: ['Ward Dictation', 'Clinic Intake'],
      },
      { name: 'Rhea Santos', email: 'rhea.santos@harbourline.example', role: 'reviewer', projects: ['Ward Dictation'] },
      {
        name: 'Ari Lindqvist',
        email: 'ari.lindqvist@harbourline.example',
        role: 'approver',
        projects: ['Ward Dictation'],
      },
      { name: 'Jo Adeyemi', email: 'jo.adeyemi@harbourline.example', role: 'reviewer', projects: ['Clinic Intake'] },
      { name: 'Kim Baptiste', email: 'kim.baptiste@harbourline.example', role: 'billing', projects: 'all' },
    ],
  },
  {
    name: 'Corvane Contact',
    slug: 'corvane',
    plan: 'scale',
    projects: [
      {
        name: 'Agent Assist EU',
        quotaMinutes: 3000,
        keySecret: 'lf_live_00000000000000000000000000000c01',
        keyName: 'Seed assist key',
      },
    ],
    members: [
      { name: 'Nadia Voss', email: 'nadia.voss@corvane.example', role: 'admin', projects: 'all' },
      { name: 'Sam Ruiz', email: 'sam.ruiz@corvane.example', role: 'developer', projects: ['Agent Assist EU'] },
      { name: 'Lee Chandra', email: 'lee.chandra@corvane.example', role: 'reviewer', projects: ['Agent Assist EU'] },
    ],
  },
];

export interface SeedSession {
  readonly label: string;
  readonly orgSlug: string;
  readonly projectName: string;
  readonly channels: number;
  readonly durationMs: number;
  readonly sidecar: string;
}

export const seedSessions: readonly SeedSession[] = [
  {
    label: 'Seed dictation 01',
    orgSlug: 'harbourline',
    projectName: 'Ward Dictation',
    channels: 1,
    durationMs: 12_000,
    sidecar: [
      'WEBVTT',
      '',
      '00:00.000 --> 00:03.000',
      'patient@0.97 reports@0.95 dizziness@0.91',
      '',
      '00:03.000 --> 00:06.000',
      'after@0.93 starting@0.88 lisinopril@0.52',
      '',
      '00:06.000 --> 00:09.000',
      'fifteen@0.71 milligrams@0.90 daily@0.94',
      '',
      '00:09.000 --> 00:12.000',
      'review@0.96 in@0.93 two@0.58 weeks@0.90',
      '',
    ].join('\n'),
  },
  {
    label: 'Seed call 01',
    orgSlug: 'corvane',
    projectName: 'Agent Assist EU',
    channels: 2,
    durationMs: 75_000,
    sidecar: [
      'WEBVTT',
      '',
      '00:00.000 --> 00:05.000',
      'thanks@0.96 for@0.95 calling@0.94 corvane@0.62',
      '',
      '00:05.000 --> 00:10.000',
      'your@0.93 policy@0.90 number@0.88 is@0.97 four@0.55 one@0.91 seven@0.89',
      '',
    ].join('\n'),
  },
];

export const seedSessionAudio = (session: SeedSession): Buffer =>
  seedAudio(session.durationMs, session.channels, session.label);
