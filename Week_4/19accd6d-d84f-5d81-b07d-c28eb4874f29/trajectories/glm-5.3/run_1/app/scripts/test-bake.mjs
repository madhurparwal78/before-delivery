// Verifies the brief's worked examples against the compiled bake engine.
import { runStep } from '../build/server/src/worker/bake.js';
import { stepFrom } from '../build/server/shared/catalogue.js';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');
let failures = 0;
let passed = 0;

async function check(name, step, inputText, expected) {
  const out = await runStep(stepFrom(step.op, step.args ?? {}), enc.encode(inputText));
  if (!out.ok) { console.log(`FAIL ${name}: errored: ${out.message}`); failures++; return; }
  const actual = dec.decode(out.output);
  if (actual !== expected) { console.log(`FAIL ${name}:\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`); failures++; return; }
  passed++; console.log(`ok   ${name}`);
}

async function checkBytes(name, step, inputBytes, expectedHex) {
  const out = await runStep(stepFrom(step.op, step.args ?? {}), new Uint8Array(inputBytes));
  if (!out.ok) { console.log(`FAIL ${name}: ${out.message}`); failures++; return; }
  const actual = [...out.output].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  if (actual !== expectedHex) { console.log(`FAIL ${name}: expected ${expectedHex} got ${actual}`); failures++; return; }
  passed++; console.log(`ok   ${name}`);
}

async function checkErr(name, step, input, expected) {
  const bytes = typeof input === 'string' ? enc.encode(input) : new Uint8Array(input);
  const out = await runStep(stepFrom(step.op, step.args ?? {}), bytes);
  if (out.ok) { console.log(`FAIL ${name}: expected error, got output`); failures++; return; }
  if (out.message !== expected) { console.log(`FAIL ${name}:\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(out.message)}`); failures++; return; }
  passed++; console.log(`ok   ${name}`);
}

// Encoding
await check('To Base64 hello', { op: 'To Base64' }, 'Hello, world!', 'SGVsbG8sIHdvcmxkIQ==');
await checkBytes('To Base64 5 bytes std', { op: 'To Base64' }, [0xfb, 0xff, 0xfe, 0x3e, 0x3f], '2b 2f 2f 2b 50 6a 38 3d');
const urlOut = await runStep(stepFrom('To Base64', { alphabet: 'URL-safe' }), new Uint8Array([0xfb, 0xff, 0xfe, 0x3e, 0x3f]));
const urlActual = String.fromCharCode(...urlOut.output);
if (urlActual !== '-__-Pj8') { console.log(`FAIL To Base64 url-safe: got ${urlActual}`); failures++; } else { console.log('ok   To Base64 url-safe'); passed++; }
await check('From Base64 hello', { op: 'From Base64' }, 'SGVsbG8sIHdvcmxkIQ==', 'Hello, world!');
await check('From Base64 lenient whitespace', { op: 'From Base64' }, 'SGVs\n bG8=', 'Hello');
await checkErr('From Base64 bad char', { op: 'From Base64' }, 'QU=B', "Invalid Base64 character '=' at position 2");
await checkErr('From Base64 non-ascii', { op: 'From Base64' }, 'é', "Invalid Base64 character '\\xc3' at position 0");
await checkErr('From Base64 length', { op: 'From Base64' }, 'Q', 'Base64 length is invalid');
await checkErr('From Base64 strict whitespace', { op: 'From Base64', args: { strict: true } }, 'SGVs\nbG8=', "Invalid Base64 character '\\n' at position 4");
await checkErr('From Base64 strict no padding', { op: 'From Base64', args: { strict: true } }, 'SGVsbG8', 'Base64 padding is missing');
await check('To Hex', { op: 'To Hex' }, 'Hi!\n', '48 69 21 0a');
await check('To Hex colon', { op: 'To Hex', args: { delimiter: 'Colon' } }, 'Hi!\n', '48:69:21:0a');
await check('From Hex', { op: 'From Hex' }, '48 69 21 0a', 'Hi!\n');
await checkErr('From Hex bad digit', { op: 'From Hex' }, '4g', "Invalid hex digit 'g' at position 1");
await checkErr('From Hex odd', { op: 'From Hex' }, 'abc', 'Odd number of hex digits');
await check('To Hexdump', { op: 'To Hexdump' }, 'Wringbench hexdump\n',
  '00000000  57 72 69 6e 67 62 65 6e 63 68 20 68 65 78 64 75  |Wringbench hexdu|\n00000010  6d 70 0a                                         |mp.|');
await checkErr('From Hexdump bad', { op: 'From Hexdump' }, '00000000  4g 69  |Hi|', 'Invalid hexdump line 1');
await checkErr('From Hexdump no bar', { op: 'From Hexdump' }, '00000000  48 69  Hi', 'Invalid hexdump line 1');
await check('From Hexdump roundtrip', { op: 'From Hexdump' },
  '00000000  57 72  |Wr|\n00000002  69 6e  |in|', 'Wrin');
await check('URL Encode', { op: 'URL Encode' }, 'a b&c=d/é~', 'a%20b%26c%3Dd%2F%C3%A9~');
await check('URL Encode keep reserved', { op: 'URL Encode', args: { encodeAllReserved: false } }, 'a b&c=d/é~', 'a%20b&c=d/%C3%A9~');
await check('URL Decode', { op: 'URL Decode' }, 'a%20b%26c%3Dd%2F%C3%A9~', 'a b&c=d/é~');
await checkErr('URL Decode bad', { op: 'URL Decode' }, 'a%2', 'Invalid percent sequence at position 1');
await check('To Binary', { op: 'To Binary' }, 'Hi', '01001000 01101001');
await check('From Binary', { op: 'From Binary' }, '01001000 01101001', 'Hi');
await checkErr('From Binary odd', { op: 'From Binary' }, '0100100', 'Bit count is not a multiple of 8');
await checkErr('From Binary bad digit', { op: 'From Binary' }, '0100a00', "Invalid binary digit 'a' at position 4");
await check('To Decimal', { op: 'To Decimal' }, 'Hi', '72 105');
await check('From Decimal', { op: 'From Decimal' }, '72 105', 'Hi');
await checkErr('From Decimal 256', { op: 'From Decimal' }, '256', 'Value 256 is not a byte');

// Text
await checkBytes('Encode Text ISO é', { op: 'Encode Text', args: { encoding: 'ISO-8859-1' } }, [0xc3, 0xa9], 'e9');
await checkErr('Encode Text ISO €', { op: 'Encode Text', args: { encoding: 'ISO-8859-1' } }, '€', 'Character U+20AC cannot be encoded in ISO-8859-1');
await checkBytes('Decode Text ISO', { op: 'Decode Text', args: { encoding: 'ISO-8859-1' } }, [0xe9], 'c3 a9');
await checkErr('Decode Text odd UTF-16', { op: 'Decode Text', args: { encoding: 'UTF-16LE' } }, 'abc', 'UTF-16LE input has an odd number of bytes');
await check('Change Case upper', { op: 'Change Case' }, 'aBc', 'ABC');
await check('Reverse chars', { op: 'Reverse' }, 'abc', 'cba');
await check('Reverse lines', { op: 'Reverse', args: { by: 'Line' } }, 'a\nb\nc', 'c\nb\na');
await check('Reverse lines trailing', { op: 'Reverse', args: { by: 'Line' } }, 'a\nb\n', 'b\na\n');
await check('Remove Whitespace', { op: 'Remove Whitespace' }, 'a b\tc\nd', 'abcd');
await check('Normalize LF', { op: 'Normalize Line Endings' }, 'a\r\nb\rc', 'a\nb\nc');
await check('Normalize CRLF', { op: 'Normalize Line Endings', args: { to: 'CRLF' } }, 'a\r\nb\nc', 'a\r\nb\r\nc');
await check('Find and Replace', { op: 'Find and Replace', args: { find: '(\\w+)@(\\w+)', replace: '$2 at $1' } }, 'ana@home bo@work', 'home at ana work at bo');
await check('Extract Matches', { op: 'Extract Matches', args: { find: '\\d+' } }, 'a1b22c333', '1\n22\n333');
{ const out = await runStep(stepFrom('Find and Replace', { find: '(' }), enc.encode('abc'));
  if (!out.ok && out.message.startsWith('Invalid regular expression: ')) { console.log('ok   Find and Replace bad regex'); passed++; }
  else { console.log(`FAIL Find and Replace bad regex: ${out.ok ? 'no error' : out.message}`); failures++; } }
await check('Sort Lines alpha', { op: 'Sort Lines' }, 'pear\napple\nFig\n', 'Fig\napple\npear\n');
await check('Sort Lines ignore case', { op: 'Sort Lines', args: { order: 'Alphabetical, ignore case' } }, 'pear\napple\nFig\n', 'apple\nFig\npear\n');
await check('Sort Lines numeric', { op: 'Sort Lines', args: { order: 'Numeric' } }, '10\n9\n-2\nx\n', '-2\n9\n10\nx\n');
await check('Unique Lines', { op: 'Unique Lines' }, 'a\nb\na\n', 'a\nb\n');

// Data formats
await check('JSON Beautify', { op: 'JSON Beautify' }, '{"a":1}', '{\n  "a": 1\n}');
await check('JSON Minify', { op: 'JSON Minify' }, '{ "a": 1.50, "b": "\\u00e9" }', '{"a":1.5,"b":"é"}');
await checkErr('JSON Beautify bad', { op: 'JSON Beautify' }, '{a:}', 'Invalid JSON at line 1 column 2');
await check('CSV to JSON', { op: 'CSV to JSON' }, 'name,qty\n"Kettle, copper",2\n', '[\n  {\n    "name": "Kettle, copper",\n    "qty": "2"\n  }\n]');
await check('CSV to JSON empty', { op: 'CSV to JSON' }, '', '[]');
await checkErr('CSV to JSON unclosed', { op: 'CSV to JSON' }, 'a\n"bc', 'Unclosed quote at line 2');
await checkErr('CSV to JSON fields', { op: 'CSV to JSON' }, 'a,b\n1,2,3', 'Row 2 has 3 fields; expected 2');
await checkErr('CSV to JSON dup header', { op: 'CSV to JSON' }, 'a,a\n1,2', "Duplicate header 'a' at column 1");
await check('JSON to CSV', { op: 'JSON to CSV' }, '[{"a":1,"b":"x"}]', 'a,b\n1,x');
await checkErr('JSON to CSV not objects', { op: 'JSON to CSV' }, '[1,2]', 'JSON to CSV needs an array of objects');

// Checksums
await check('MD5', { op: 'MD5' }, 'abc', '900150983cd24fb0d6963f7d28e17f72');
await check('SHA-1', { op: 'SHA-1' }, 'abc', 'a9993e364706816aba3e25717850c26c9cd0d89d');
await check('SHA-256', { op: 'SHA-256' }, 'abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
await check('CRC32', { op: 'CRC32' }, 'abc', '352441c2');

// Compression round-trip
const gzOut = await runStep(stepFrom('Gzip'), enc.encode('Hello, Wringbench!'));
const gzBack = await runStep(stepFrom('Gunzip'), gzOut.output);
if (dec.decode(gzBack.output) !== 'Hello, Wringbench!') { console.log('FAIL Gzip roundtrip'); failures++; } else { console.log('ok   Gzip roundtrip'); passed++; }
if (gzOut.output[0] !== 0x1f || gzOut.output[1] !== 0x8b) { console.log('FAIL Gzip magic'); failures++; } else { console.log('ok   Gzip magic'); passed++; }
await checkErr('Gunzip not gzip', { op: 'Gunzip' }, 'abc', 'Not gzip data');

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
