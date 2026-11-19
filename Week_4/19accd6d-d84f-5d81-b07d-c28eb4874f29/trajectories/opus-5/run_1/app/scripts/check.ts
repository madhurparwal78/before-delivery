/* Worked-example harness for the brief. Run with: node scripts/check.mjs */
import { findOperation, normalizeArgs, operations } from '../src/shared/ops.js';
import { fromText, decodeLossy, countLines, encodeText, OpError, encodeBase64 } from '../src/shared/bytes.js';
import { bake } from '../src/worker/pipeline.js';
import { buildRecipeLink, compareVersions, parseRecipeLink } from '../src/shared/recipe.js';
import { parseWringLine } from '../src/shared/wringline.js';
import { carrySpan } from '../src/shared/span.js';
import { formatStamp, parseTtl, byteLineStatus } from '../src/shared/format.js';
import type { RecipeStep } from '../src/shared/recipe.js';
import { outputView, suggestOperation, STARTER_INPUT } from '../src/client/workbench-state.js';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${a}\n  expected ${b}`);
  }
}

function run(name: string, input: Uint8Array | string, args: Record<string, unknown> = {}): string {
  const op = findOperation(name)!;
  const bytes = typeof input === 'string' ? fromText(input) : input;
  try {
    return decodeLossy(op.run!(bytes, normalizeArgs(op, args as never)));
  } catch (error) {
    if (error instanceof OpError) return `ERR: ${error.message}`;
    throw error;
  }
}

function runBytes(name: string, input: Uint8Array | string, args: Record<string, unknown> = {}): Uint8Array {
  const op = findOperation(name)!;
  const bytes = typeof input === 'string' ? fromText(input) : input;
  return op.run!(bytes, normalizeArgs(op, args as never));
}

check('catalogue size', operations.length, 34);

// Encoding
check('to base64', run('To Base64', 'Hello, world!'), 'SGVsbG8sIHdvcmxkIQ==');
const tricky = new Uint8Array([0xfb, 0xff, 0xfe, 0x3e, 0x3f]);
check('to base64 standard', run('To Base64', tricky), '+//+Pj8=');
check('to base64 url', run('To Base64', tricky, { alphabet: 'URL-safe' }), '-__-Pj8');
check('from base64', run('From Base64', 'SGVsbG8sIHdvcmxkIQ=='), 'Hello, world!');
check('from base64 ws', run('From Base64', 'SGVs bG8s\nIHdvcmxkIQ'), 'Hello, world!');
check('from base64 non-ascii', run('From Base64', new Uint8Array([0xc3, 0xa9])), "ERR: Invalid Base64 character '\\xc3' at position 0");
check('from base64 mid pad', run('From Base64', 'QU=B'), "ERR: Invalid Base64 character '=' at position 2");
check('from base64 triple pad', run('From Base64', 'QQ==='), "ERR: Invalid Base64 character '=' at position 4");
check('from base64 length', run('From Base64', 'Q'), 'ERR: Base64 length is invalid');
check('from base64 strict pad', run('From Base64', 'QUJ', { strict: true }), 'ERR: Base64 padding is missing');
check('from base64 strict ws', run('From Base64', 'QQ ==', { strict: true }), "ERR: Invalid Base64 character ' ' at position 2");
check('to hex space', run('To Hex', 'Hi!\n'), '48 69 21 0a');
check('to hex colon', run('To Hex', 'Hi!\n', { delimiter: 'Colon' }), '48:69:21:0a');
check('from hex', run('From Hex', '48:69 21,0A'), 'Hi!\n');
check('from hex bad', run('From Hex', '4g'), "ERR: Invalid hex digit 'g' at position 1");
check('from hex odd', run('From Hex', '486'), 'ERR: Odd number of hex digits');
check(
  'to hexdump',
  run('To Hexdump', 'Wringbench hexdump\n'),
  '00000000  57 72 69 6e 67 62 65 6e 63 68 20 68 65 78 64 75  |Wringbench hexdu|\n' +
    '00000010  6d 70 0a                                         |mp.|',
);
check('from hexdump', run('From Hexdump', run('To Hexdump', 'Wringbench hexdump\n')), 'Wringbench hexdump\n');
check('from hexdump bad', run('From Hexdump', '00000000  4g 69  |Hi|'), 'ERR: Invalid hexdump line 1');
check('from hexdump no bar', run('From Hexdump', '00000000  48 69  |Hi'), 'ERR: Invalid hexdump line 1');
check('url encode', run('URL Encode', 'a b&c=d/é~'), 'a%20b%26c%3Dd%2F%C3%A9~');
check('url encode off', run('URL Encode', 'a b&c=d/é~', { encodeAllReserved: false }), 'a%20b&c=d/%C3%A9~');
check('url decode', run('URL Decode', 'a%20b+c%C3%A9'), 'a b+cé');
check('url decode bad', run('URL Decode', 'a%2'), 'ERR: Invalid percent sequence at position 1');
check('to binary', run('To Binary', 'Hi'), '01001000 01101001');
check('from binary', run('From Binary', '01001000 01101001'), 'Hi');
check('from binary bad', run('From Binary', '0100100a'), "ERR: Invalid binary digit 'a' at position 7");
check('from binary count', run('From Binary', '0100100'), 'ERR: Bit count is not a multiple of 8');
check('to decimal', run('To Decimal', 'Hi'), '72 105');
check('from decimal', run('From Decimal', '72,105'), 'Hi');
check('from decimal bad', run('From Decimal', '72 300'), 'ERR: Value 300 is not a byte');

// Text
check('encode text latin1', [...runBytes('Encode Text', 'é', { encoding: 'ISO-8859-1' })], [0xe9]);
check('encode text euro', run('Encode Text', '€', { encoding: 'ISO-8859-1' }), 'ERR: Character U+20AC cannot be encoded in ISO-8859-1');
check('decode text latin1', run('Decode Text', new Uint8Array([0xe9]), { encoding: 'ISO-8859-1' }), 'é');
check('decode text utf16 odd', run('Decode Text', new Uint8Array([0x61]), { encoding: 'UTF-16LE' }), 'ERR: UTF-16LE input has an odd number of bytes');
check('decode text invalid utf8', run('Decode Text', new Uint8Array([0xff])), 'ERR: Input is not valid UTF-8 text');
check('change case', run('Change Case', 'Straße'), 'STRASSE');
check('reverse chars', run('Reverse', 'abc😀'), '😀cba');
check('reverse lines', run('Reverse', 'a\nb\nc\n', { by: 'Line' }), 'c\nb\na\n');
check('remove whitespace', run('Remove Whitespace', 'a b\tc\nd'), 'abcd');
check('normalize lf', run('Normalize Line Endings', 'a\r\nb\rc\n'), 'a\nb\nc\n');
check('normalize crlf', run('Normalize Line Endings', 'a\r\nb\rc\n', { to: 'CRLF' }), 'a\r\nb\r\nc\r\n');
check('find replace', run('Find and Replace', 'ana@home bo@work', { find: '(\\w+)@(\\w+)', replace: '$2 at $1' }), 'home at ana work at bo');
check('find replace empty', run('Find and Replace', 'abc'), 'abc');
check('extract matches', run('Extract Matches', 'a1b22c333', { find: '\\d+' }), '1\n22\n333');
check('extract none', run('Extract Matches', 'abc', { find: '\\d+' }), '');
check('sort alpha', run('Sort Lines', 'pear\napple\nFig\n'), 'Fig\napple\npear\n');
check('sort ignore case', run('Sort Lines', 'pear\napple\nFig\n', { order: 'Alphabetical, ignore case' }), 'apple\nFig\npear\n');
check('sort numeric', run('Sort Lines', '10\n9\n-2\nx\n', { order: 'Numeric' }), '-2\n9\n10\nx\n');
check('sort unique ignore case', run('Sort Lines', 'A\na\nb\n', { order: 'Alphabetical, ignore case', unique: true }), 'A\nb\n');
check('sort reverse', run('Sort Lines', '10\n9\n-2\nx\n', { order: 'Numeric', reverse: true }), 'x\n10\n9\n-2\n');
check('unique lines', run('Unique Lines', 'a\nb\na\nc\n'), 'a\nb\nc\n');

// Data formats
check('json beautify', run('JSON Beautify', '{"a":1.50,"b":[1,2]}'), '{\n  "a": 1.5,\n  "b": [\n    1,\n    2\n  ]\n}');
check('json beautify tab', run('JSON Beautify', '{"a":1}', { indent: 'Tab' }), '{\n\t"a": 1\n}');
check('json minify', run('JSON Minify', '{"a": 1.50, "b": "\\u00e9"}'), '{"a":1.5,"b":"é"}');
check('json big number', run('JSON Minify', '12345678901234567890'), '12345678901234567000');
check('json error', run('JSON Minify', '{"a": }'), 'ERR: Invalid JSON at line 1 column 7');
check('json error end', run('JSON Minify', '{"a":1'), 'ERR: Invalid JSON at line 1 column 7');
check('csv to json', run('CSV to JSON', 'name,qty\n"Kettle, copper",2\n'), '[\n  {\n    "name": "Kettle, copper",\n    "qty": "2"\n  }\n]');
check('csv empty', run('CSV to JSON', ''), '[]');
check('csv header only', run('CSV to JSON', 'a,b\n'), '[]');
check('csv no header', run('CSV to JSON', 'a,b\nc,d\n', { firstRowIsHeader: false }), '[\n  [\n    "a",\n    "b"\n  ],\n  [\n    "c",\n    "d"\n  ]\n]');
check('csv row count', run('CSV to JSON', 'a,b\nc\n'), 'ERR: Row 2 has 1 fields; expected 2');
check('csv unclosed', run('CSV to JSON', 'a,b\n"c,d\n'), 'ERR: Unclosed quote at line 2');
check('csv duplicate header', run('CSV to JSON', 'a,b,a\n1,2,3\n'), "ERR: Duplicate header 'a' at column 3");
check('json to csv', run('JSON to CSV', '[{"a":1,"b":"x,y"},{"a":null,"c":3}]'), 'a,b\n1,"x,y"\n,');
check('json to csv bad', run('JSON to CSV', '[1]'), 'ERR: JSON to CSV needs an array of objects');

// Checksums
check('md5', run('MD5', 'abc'), '900150983cd24fb0d6963f7d28e17f72');
check('sha1', run('SHA-1', 'abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
check('sha256', run('SHA-256', 'abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
check('crc32', run('CRC32', 'abc'), '352441c2');
check('md5 empty', run('MD5', ''), 'd41d8cd98f00b204e9800998ecf8427e');
check('sha256 long', run('SHA-256', 'a'.repeat(200)).length, 64);

// Compression
const gz = runBytes('Gzip', 'Wringbench');
check('gzip magic', [gz[0], gz[1]], [0x1f, 0x8b]);
check('gunzip roundtrip', run('Gunzip', gz), 'Wringbench');
check('gunzip not gzip', run('Gunzip', 'abc'), 'ERR: Not gzip data');
const damaged = runBytes('Gzip', 'Wringbench');
damaged[damaged.length - 5] = (damaged[damaged.length - 5]! ^ 0xff) & 0xff;
check('gunzip damaged', run('Gunzip', damaged), 'ERR: Gzip data is damaged');

// Pipeline
function pipeline(steps: RecipeStep[], input: string, stopBefore: number | null = null) {
  return bake({ input: fromText(input), steps, stopBefore }, () => {});
}
const step = (op: string, args: Record<string, unknown> = {}, extra: Partial<RecipeStep> = {}): RecipeStep => ({
  op,
  args: args as never,
  disabled: extra.disabled ?? false,
  breakpoint: extra.breakpoint ?? false,
});

const fork = pipeline([step('Fork'), step('From Base64'), step('Merge')], 'aGk=\nb2s=');
check('fork merge', decodeLossy(fork.output), 'hi\nok');
const forkError = pipeline([step('Fork'), step('From Base64'), step('Merge')], 'aGk=\nb2s=\n!!');
check('fork branch error', forkError.error, { stepIndex: 1, op: 'From Base64', branch: 3, message: "Invalid Base64 character '!' at position 0" });
check('merge alone', pipeline([step('Merge')], 'x').error?.message, 'Merge has no matching Fork');
check('nested fork', pipeline([step('Fork'), step('Fork'), step('Merge')], 'x').error, {
  stepIndex: 1,
  op: 'Fork',
  branch: null,
  message: 'Fork cannot start inside another Fork',
});
const disabledRun = pipeline([step('To Hex'), step('Change Case', { case: 'Upper' }, { disabled: true }), step('To Base64')], 'Hi');
check('disabled skipped', decodeLossy(disabledRun.output), encodeBase64(fromText('48 69'), false));
const paused = pipeline([step('To Hex'), step('To Base64')], 'Hello', 1);
check('pause output', decodeLossy(paused.output), '48 65 6c 6c 6f');
check('pause index', paused.pausedAt, 1);

// Span carry
const spanSteps = [step('To Hex'), step('To Base64')];
const spanRun = pipeline(spanSteps, 'Hello');
let range: { start: number; end: number } | null = { start: 1, end: 4 };
let lengths = [fromText('Hello').length, ...spanRun.stepLengths.map((entry) => entry.outputLength)];
const chips: string[] = [];
for (let i = 0; i < spanSteps.length && range !== null; i += 1) {
  const op = findOperation(spanSteps[i]!.op)!;
  range = carrySpan(op, normalizeArgs(op, spanSteps[i]!.args), range, lengths[i]!, lengths[i + 1]!);
  if (range !== null) chips.push(`output ${range.start}\u2013${range.end - 1}`);
}
check('span chips', chips, ['output 3\u201310', 'output 4\u201315']);
check('span status', byteLineStatus(spanRun.output.length, countLines(spanRun.output)) + ' · Selection maps to characters 4\u201315', '20 bytes · 1 line · Selection maps to characters 4\u201315');

// Counts and encodings
check('utf8 bytes', [...encodeText('aé€😀', 'UTF-8')], [0x61, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]);
check('line count', byteLineStatus(fromText('a\n').length, countLines(fromText('a\n'))), '2 bytes · 2 lines');
check('empty count', byteLineStatus(0, countLines(new Uint8Array())), '0 bytes · 0 lines');
check('crlf count', countLines(fromText('a\r\nb')), 2);

// Links
check('recipe link', buildRecipeLink([step('To Base64', { alphabet: 'Standard' })], fromText('Hi!')),
  '/w#r=W3sib3AiOiJUbyBCYXNlNjQiLCJhcmdzIjp7ImFscGhhYmV0IjoiU3RhbmRhcmQifX1d&i=SGkh');
const parsedLink = parseRecipeLink('#r=W3sib3AiOiJUbyBCYXNlNjQiLCJhcmdzIjp7ImFscGhhYmV0IjoiU3RhbmRhcmQifX1d&i=SGkh');
check('link roundtrip', typeof parsedLink === 'object' ? [parsedLink.steps[0]!.op, decodeLossy(parsedLink.input)] : parsedLink, ['To Base64', 'Hi!']);
check('link damaged recipe', parseRecipeLink('#r=!!&i=SGkh'), 'recipe');
check('link damaged input', parseRecipeLink('#r=W3sib3AiOiJUbyBCYXNlNjQiLCJhcmdzIjp7ImFscGhhYmV0IjoiU3RhbmRhcmQifX1d&i=!!'), 'input');

// Compare
check(
  'compare example',
  compareVersions(
    { name: 'R', steps: [{ op: 'To Base64', args: {}, disabled: false }, { op: 'To Hex', args: { delimiter: 'Space' }, disabled: false }, { op: 'SHA-256', args: {}, disabled: false }] },
    { name: 'R', steps: [{ op: 'SHA-256', args: {}, disabled: false }, { op: 'To Base64', args: {}, disabled: false }, { op: 'To Hex', args: { delimiter: 'Colon' }, disabled: false }] },
  ),
  ['Moved SHA-256 from step 3 to step 1', 'Changed To Hex at step 3: Delimiter from Space to Colon'],
);
check(
  'compare rename and disable',
  compareVersions(
    { name: 'A', steps: [{ op: 'MD5', args: {}, disabled: false }] },
    { name: 'B', steps: [{ op: 'MD5', args: {}, disabled: true }, { op: 'CRC32', args: {}, disabled: false }] },
  ),
  ['Renamed from A to B', 'Disabled MD5 at step 1', 'Added CRC32 at step 2'],
);
check(
  'compare removal',
  compareVersions(
    { name: 'A', steps: [{ op: 'MD5', args: {}, disabled: false }, { op: 'CRC32', args: {}, disabled: false }] },
    { name: 'A', steps: [{ op: 'CRC32', args: {}, disabled: false }] },
  ),
  ['Removed MD5 from step 1'],
);

// Wring Line
const wring = parseWringLine('wringline 1\n# name: Webhook body\nunb64\ngunzip\nJSON Beautify(indent=4)\nhexify(sep=colon)\n');
check('wringline problems', wring.problems, []);
check('wringline name', wring.name, 'Webhook body');
check('wringline count', wring.lineCount, 4);
check('wringline steps', wring.steps.map((s) => [s.op, s.args]), [
  ['From Base64', {}],
  ['Gunzip', {}],
  ['JSON Beautify', { indent: '4' }],
  ['To Hex', { delimiter: 'Colon' }],
]);
const wringBad = parseWringLine('wringline 1\n# name: Webhook body\nunb64\nrot13\nJSON Beautify(indent=4)\nhexify(case=upper)\n');
check('wringline bad', wringBad.problems, ["Line 4: unknown operation 'rot13'", "Line 6: unknown argument 'case' for To Hex"]);
check('wringline header', parseWringLine('nope').problems, ["Line 1: expected 'wringline 1'"]);
check('wringline invalid value', parseWringLine('wringline 1\nhexify(sep=sideways)').problems, ["Line 2: invalid value 'sideways' for Delimiter of To Hex"]);
check('wringline escapes', parseWringLine('wringline 1\nFork(split delimiter=a\\;b)').steps[0]!.args, { splitDelimiter: 'a;b' });

// Format
check('stamp', formatStamp('2026-11-06T09:00:00Z'), '6 November 2026 at 09:00 UTC');
check('ttl 1h', parseTtl('1h'), { code: '1h', label: '1 hour', seconds: 3600 });
check('ttl 7d', parseTtl('7d')!.label, '7 days');
check('ttl bad', parseTtl('1x'), null);

// Suggestion detection
check('suggest gunzip', suggestOperation(runBytes('Gzip', 'hello')), 'Gunzip');
check('suggest from hex', suggestOperation(fromText('48 65 6c 6c 6f')), 'From Hex');
check('suggest from hex colons', suggestOperation(fromText('48:65:6c:6c')), 'From Hex');
check('suggest from base64', suggestOperation(fromText('SGVsbG8sIHdvcmxkIQ==')), 'From Base64');
check('suggest json', suggestOperation(fromText('{"a": 1}')), 'JSON Beautify');
check('suggest url decode', suggestOperation(fromText('a%20b')), 'URL Decode');
check('suggest nothing', suggestOperation(fromText('plain words here')), null);
check('suggest hex needs four pairs', suggestOperation(fromText('48 65')), null);

// Output view
check('output text view', outputView(fromText('hi'), 'Text', 100, null), {
  text: 'hi',
  notices: [],
  status: '2 bytes · 1 line',
  tint: null,
});
check('output hex fallback', outputView(new Uint8Array([0x61, 0xff, 0x62]), 'Text', 100, null), {
  text: '61 ff 62',
  notices: ['Output is not valid UTF-8; showing hex.'],
  status: '3 bytes · 1 line',
  tint: null,
});
check('output truncation', outputView(fromText('abcdef'), 'Text', 4, null), {
  text: 'abcd',
  notices: ['Showing the first 4 of 6 bytes. Download output for all of it.'],
  status: '6 bytes · 1 line',
  tint: null,
});
check('output truncation keeps whole characters', outputView(fromText('aé'), 'Text', 2, null).text, 'a');
check('output hex view', outputView(fromText('Hi'), 'Hex', 100, null).text, '48 69');

// Starter recipe
const starterJson = '{"event":"invoice.paid","invoice":{"id":"inv_1042","amount":4200,"currency":"EUR"},"items":["kettle","cloth"]}';
const starterInput = encodeBase64(runBytes('Gzip', starterJson), false);
check('starter input constant matches the catalogue gzip', starterInput, STARTER_INPUT);
const starter = pipeline([step('From Base64'), step('Gunzip'), step('JSON Beautify')], starterInput);
check('starter output', decodeLossy(starter.output), `{
  "event": "invoice.paid",
  "invoice": {
    "id": "inv_1042",
    "amount": 4200,
    "currency": "EUR"
  },
  "items": [
    "kettle",
    "cloth"
  ]
}`);
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECKS FAILED`);
if (failures > 0) process.exitCode = 1;
