import { SEED_CIS, SEED_RELATIONSHIPS } from '../src/server/seeddata.js';
import { CiNode, Edge, computeImpact, computeLayout, effectiveStatuses } from '../src/server/servicemap.js';

const cis: CiNode[] = SEED_CIS.map(c => ({
  name: c.name, class: c.class as never, criticality: c.criticality,
  business_critical: c.business_critical ?? false, owner_department: 'IT provider',
  status: 'healthy', attributes: c.attributes ?? {},
  used_by_departments: c.used_by_departments ?? [], used_by_people: c.used_by_people ?? [],
}));
const edges: Edge[] = SEED_RELATIONSHIPS.map(([s, t, g]) => ({ source: s, type: t as never, target: g }));

// Department membership from the seed
const pad = (n: number): string => String(n).padStart(2, '0');
const range = (prefix: string, count: number): string[] => Array.from({ length: count }, (_, i) => `${prefix}${pad(i + 1)}`);

const members = new Map<string, string[]>([
  ['Design Studio', ['ruth', 'dev', 'mae', ...range('design', 45)]],
  ['Finance', ['kofi', 'ana', 'hugo', ...range('fin', 6)]],
  ['Studio Operations', ['jonas', ...range('ops', 13)]],
  ['Leadership', range('lead', 6)],
]);

const now = Date.now();
const failed = cis.find(c => c.name === 'Main storage array')!;
failed.status = 'down';
const impact = computeImpact(failed, cis, edges, [], now, members);
console.log('affected order:', impact.affected.map(a => a.ci.name).join(', '));
console.log('expect:         Host cluster, dir-vm, Directory, Sign-in, Mail, Payroll, Project files, Remote access, mail-vm, Mail relay, payroll-vm, Payroll app, print-vm, Print server, Printing');
console.log('people_total:', impact.people_total, 'expect 77');
console.log('business_critical_affected:', impact.business_critical_affected, 'expect 4');
console.log('base_people:', impact.base_people, 'expect 0');
const firstBusiness = impact.affected.findIndex(a => a.ci.name === 'Sign-in');
console.log('running before Sign-in:', impact.affected[firstBusiness - 1]?.running_people, 'expect 0');
console.log('running at Sign-in:', impact.affected[firstBusiness].running_people, 'expect 77');
failed.status = 'healthy';
