import { parse, ExpressionError } from '../src/express/expression.js';

function expectErr(text: string, col: number, reason: string): void {
  try {
    parse(text);
    console.log(`FAIL: ${JSON.stringify(text)} parsed OK`);
  } catch (e) {
    if (e instanceof ExpressionError) {
      const ok = e.column === col && e.reason === reason;
      console.log(`${ok ? 'OK  ' : 'FAIL'}: ${JSON.stringify(text)} -> col ${e.column} (want ${col}), ${e.reason} (want ${reason})`);
    } else {
      console.log(`FAIL: ${JSON.stringify(text)} -> ${e}`);
    }
  }
}

function ok(t: string): void {
  try { parse(t); console.log(`OK  parse: ${t}`); }
  catch (e) { console.log(`FAIL parse: ${t}: ${e}`); }
}

expectErr('priority = 1 2', 14, 'unexpected "2"');
expectErr('nosuch = 1', 1, 'unknown field "nosuch"');
expectErr('frob(1)', 1, 'unknown function "frob"');
expectErr('priority = = 1', 12, 'expected a value');
expectErr('(priority = 1', 14, 'expected ")"');
expectErr('"abc', 1, 'unexpected "\\""');

ok('is_major = true and changes_to(state, "cancelled")');
ok('configuration_item.name = "Payroll"');
ok('true');
ok('caller.department.name = "Finance"');
ok('state in ["new", "assigned"]');
ok('assigned_to.username = me() and state in ["new", "assigned", "in_progress", "on_hold"]');
ok('answers.role = "architect"');
ok('variables.model = "studio16"');
