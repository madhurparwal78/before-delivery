import {
  Argument,
  ArgumentRole,
  BodyStatement,
  CutStatement,
  Expr,
  LetStatement,
  ParamStatement,
  RepeatStatement,
  Statement,
  TineProgram,
  TineSourceError,
} from './ast';

const MAX_SOURCE_BYTES = 20000;
const MAX_PARAMETERS = 40;
const MAX_TAPE_OPERATIONS = 64;

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/;
const SOURCE_NUMBER = /^[0-9]+(\.[0-9]+)?$/;

function parseExpression(text: string, line: number): Expr {
  let at = 0;

  function fail(): never {
    throw new TineSourceError(line, `Could not read the expression ${text}.`);
  }

  function parsePrimary(): Expr {
    if (text[at] === '(') {
      at += 1;
      const inner = parseSum();
      if (text[at] !== ')') fail();
      at += 1;
      return inner;
    }
    if (text[at] === '-') {
      at += 1;
      return { k: 'neg', a: parsePrimary() };
    }
    const numberMatch = /^[0-9]+(\.[0-9]+)?/.exec(text.slice(at));
    if (numberMatch) {
      at += numberMatch[0].length;
      return { k: 'num', v: Number(numberMatch[0]) };
    }
    const nameMatch = /^[A-Za-z][A-Za-z0-9]*/.exec(text.slice(at));
    if (!nameMatch) fail();
    const name = nameMatch[0];
    at += name.length;
    if (name === 'pick') {
      if (text[at] !== '(') fail();
      at += 1;
      const enumMatch = /^[A-Za-z][A-Za-z0-9]*/.exec(text.slice(at));
      if (!enumMatch) fail();
      at += enumMatch[0].length;
      const options: { option: string; value: number }[] = [];
      while (text[at] === ',') {
        at += 1;
        const optionMatch = /^[A-Za-z0-9]+/.exec(text.slice(at));
        if (!optionMatch) fail();
        at += optionMatch[0].length;
        if (text[at] !== ':') fail();
        at += 1;
        const valueMatch = /^-?[0-9]+(\.[0-9]+)?/.exec(text.slice(at));
        if (!valueMatch) fail();
        at += valueMatch[0].length;
        options.push({ option: optionMatch[0], value: Number(valueMatch[0]) });
      }
      if (text[at] !== ')') fail();
      at += 1;
      if (options.length === 0) fail();
      return { k: 'pick', enumName: enumMatch[0], options };
    }
    return { k: 'ref', name };
  }

  function parseProduct(): Expr {
    let left = parsePrimary();
    while (text[at] === '*' || text[at] === '/') {
      const op = text[at] as '*' | '/';
      at += 1;
      left = { k: 'bin', op, a: left, b: parsePrimary() };
    }
    return left;
  }

  function parseSum(): Expr {
    let left = parseProduct();
    while (text[at] === '+' || text[at] === '-') {
      const op = text[at] as '+' | '-';
      at += 1;
      left = { k: 'bin', op, a: left, b: parseProduct() };
    }
    return left;
  }

  const expression = parseSum();
  if (at !== text.length) fail();
  return expression;
}

function argument(text: string, role: ArgumentRole, line: number): Argument {
  return { expr: parseExpression(text, line), text, role };
}

/** The first parameter named in an argument, reading left to right. */
export function firstNamedParameter(text: string, known: Set<string>): string | null {
  for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9]*/g)) {
    if (match[0] !== 'pick' && known.has(match[0])) return match[0];
  }
  return null;
}

function parseParam(tokens: string[], line: number, group: string): ParamStatement {
  const name = tokens[1];
  if (!name || !IDENTIFIER.test(name)) throw new TineSourceError(line, `${name ?? 'A parameter'} is not a parameter name.`);
  if (tokens[2] !== '=') throw new TineSourceError(line, 'A param line needs = after its name.');
  const value = tokens[3];
  if (value === undefined) throw new TineSourceError(line, 'A param line needs a value.');
  if (value === 'true' || value === 'false') {
    if (tokens.length !== 4) throw new TineSourceError(line, 'A boolean param takes no other words.');
    return { k: 'param', line, name, kind: 'boolean', defaultBoolean: value === 'true', group };
  }
  if (tokens[4] === 'options') {
    const options = tokens
      .slice(5)
      .join(' ')
      .split(',')
      .map((option) => option.trim())
      .filter((option) => option.length > 0);
    if (options.length === 0) throw new TineSourceError(line, 'An enum param needs options.');
    if (!options.includes(value)) throw new TineSourceError(line, `${value} is not one of the options.`);
    return { k: 'param', line, name, kind: 'enum', defaultOption: value, options, group };
  }
  if (!SOURCE_NUMBER.test(value)) throw new TineSourceError(line, `${value} is not a number.`);
  const unit = tokens[4];
  const kind = unit === 'mm' ? 'length' : unit === 'deg' ? 'angle' : unit === 'count' ? 'count' : null;
  if (!kind) throw new TineSourceError(line, 'A numeric param needs mm, deg or count.');
  if (kind === 'count' && !Number.isInteger(Number(value))) {
    throw new TineSourceError(line, 'A count param needs a whole number.');
  }
  const statement: ParamStatement = {
    k: 'param',
    line,
    name,
    kind,
    defaultNumber: Number(value),
    group,
  };
  let at = 5;
  while (at < tokens.length) {
    const keyword = tokens[at];
    const amount = tokens[at + 1];
    if (amount === undefined || !/^-?[0-9]+(\.[0-9]+)?$/.test(amount)) {
      throw new TineSourceError(line, `${keyword} needs a number.`);
    }
    if (keyword === 'min') statement.min = Number(amount);
    else if (keyword === 'max') statement.max = Number(amount);
    else if (keyword === 'step' && kind !== 'count') statement.stepText = amount;
    else throw new TineSourceError(line, `${keyword} is not a param option.`);
    at += 2;
  }
  return statement;
}

function parseGeometry(tokens: string[], line: number): BodyStatement | CutStatement {
  const verb = tokens[0];
  let condition: string | null = null;
  let words = tokens;
  const ifIndex = tokens.indexOf('if');
  if (ifIndex !== -1) {
    if (verb === 'box' || verb === 'cylinder') throw new TineSourceError(line, 'A body line takes no if.');
    const name = tokens[ifIndex + 1];
    if (!name || !IDENTIFIER.test(name) || tokens.length !== ifIndex + 2) {
      throw new TineSourceError(line, 'if needs one boolean parameter name.');
    }
    condition = name;
    words = tokens.slice(0, ifIndex);
  }
  if (verb === 'box') {
    if (words.length !== 4) throw new TineSourceError(line, 'box takes w d h.');
    return {
      k: 'body',
      line,
      verb: 'box',
      args: [
        argument(words[1], 'Width', line),
        argument(words[2], 'Depth', line),
        argument(words[3], 'Height', line),
      ],
    };
  }
  if (verb === 'cylinder') {
    if (words.length !== 3) throw new TineSourceError(line, 'cylinder takes dia h.');
    return {
      k: 'body',
      line,
      verb: 'cylinder',
      args: [argument(words[1], 'Diameter', line), argument(words[2], 'Height', line)],
    };
  }
  const atIndex = words.indexOf('at');
  if (atIndex === -1 || words.length !== atIndex + 3) {
    throw new TineSourceError(line, `${verb} needs at x y.`);
  }
  const at: [Argument, Argument] = [
    argument(words[atIndex + 1], 'Width', line),
    argument(words[atIndex + 2], 'Depth', line),
  ];
  const head = words.slice(1, atIndex);
  if (verb === 'hole') {
    if (head.length !== 1) throw new TineSourceError(line, 'hole takes dia at x y.');
    return { k: 'cut', line, verb: 'hole', args: [argument(head[0], 'Diameter', line)], at, condition };
  }
  if (verb === 'slot') {
    if (head.length !== 2) throw new TineSourceError(line, 'slot takes w len at x y.');
    return {
      k: 'cut',
      line,
      verb: 'slot',
      args: [argument(head[0], 'Width', line), argument(head[1], 'Length', line)],
      at,
      condition,
    };
  }
  if (verb === 'boss') {
    if (head.length !== 2) throw new TineSourceError(line, 'boss takes dia h at x y.');
    return {
      k: 'cut',
      line,
      verb: 'boss',
      args: [argument(head[0], 'Diameter', line), argument(head[1], 'Height', line)],
      at,
      condition,
    };
  }
  throw new TineSourceError(line, `${verb} is not a Tine statement.`);
}

export function parseTine(source: string): TineProgram {
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    throw new TineSourceError(1, `Source is over ${MAX_SOURCE_BYTES} bytes.`);
  }
  const lines = source.split('\n');
  const statements: Statement[] = [];
  const parameters: (ParamStatement | LetStatement)[] = [];
  let group = 'Dimensions';
  let openRepeat: RepeatStatement | null = null;
  let bodySeen = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    const text = lines[index].trim();
    if (text.length === 0 || text.startsWith('#')) continue;
    if (text === '}') {
      if (!openRepeat) throw new TineSourceError(line, 'There is no open repeat block to close.');
      openRepeat = null;
      continue;
    }
    const tokens = text.split(/\s+/);
    const keyword = tokens[0];

    if (keyword === 'section') {
      const match = /^section\s+"([^"]*)"$/.exec(text);
      if (!match) throw new TineSourceError(line, 'section takes a quoted title.');
      group = match[1];
      continue;
    }
    if (keyword === 'param') {
      if (openRepeat) throw new TineSourceError(line, 'A repeat block holds only cut and join lines.');
      const statement = parseParam(tokens, line, group);
      if (parameters.some((entry) => entry.name === statement.name)) {
        throw new TineSourceError(line, `${statement.name} is declared twice.`);
      }
      statements.push(statement);
      parameters.push(statement);
      continue;
    }
    if (keyword === 'let') {
      if (openRepeat) throw new TineSourceError(line, 'A repeat block holds only cut and join lines.');
      if (tokens[2] !== '=' || tokens.length !== 4) throw new TineSourceError(line, 'let takes a name = expression.');
      const name = tokens[1];
      if (!IDENTIFIER.test(name)) throw new TineSourceError(line, `${name} is not a parameter name.`);
      if (parameters.some((entry) => entry.name === name)) {
        throw new TineSourceError(line, `${name} is declared twice.`);
      }
      const statement: LetStatement = { k: 'let', line, name, expr: parseExpression(tokens[3], line), group };
      statements.push(statement);
      parameters.push(statement);
      continue;
    }
    if (keyword === 'repeat') {
      if (openRepeat) throw new TineSourceError(line, 'A repeat block cannot hold another repeat.');
      if (tokens.length !== 4 || tokens[3] !== '{') throw new TineSourceError(line, 'repeat takes n pitch {.');
      const statement: RepeatStatement = {
        k: 'repeat',
        line,
        count: argument(tokens[1], 'Length', line),
        pitch: argument(tokens[2], 'Length', line),
        body: [],
      };
      statements.push(statement);
      openRepeat = statement;
      continue;
    }

    const geometry = parseGeometry(tokens, line);
    if (geometry.k === 'body') {
      if (openRepeat) throw new TineSourceError(line, 'A repeat block holds only cut and join lines.');
      if (bodySeen) throw new TineSourceError(line, 'The part already has a body.');
      if (statements.some((entry) => entry.k === 'cut' || entry.k === 'repeat')) {
        throw new TineSourceError(line, 'The body must be the first geometry line.');
      }
      bodySeen = true;
      statements.push(geometry);
      continue;
    }
    if (!bodySeen) throw new TineSourceError(line, 'The body must be the first geometry line.');
    if (openRepeat) openRepeat.body.push(geometry);
    else statements.push(geometry);
  }

  if (openRepeat) throw new TineSourceError(openRepeat.line, 'This repeat block is never closed.');
  if (!bodySeen) throw new TineSourceError(1, 'Add a box or cylinder body line.');
  if (parameters.length > MAX_PARAMETERS) {
    throw new TineSourceError(parameters[MAX_PARAMETERS].line, `Tine allows at most ${MAX_PARAMETERS} parameters.`);
  }

  const known = new Set(parameters.map((entry) => entry.name));
  for (const statement of statements) {
    const geometries: (BodyStatement | CutStatement)[] =
      statement.k === 'repeat' ? statement.body : statement.k === 'body' || statement.k === 'cut' ? [statement] : [];
    for (const geometry of geometries) {
      const texts = [...geometry.args.map((entry) => entry.text)];
      if (geometry.k === 'cut') texts.push(geometry.at[0].text, geometry.at[1].text);
      for (const text of texts) {
        for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9]*/g)) {
          if (match[0] !== 'pick' && !known.has(match[0])) {
            throw new TineSourceError(geometry.line, `${match[0]} is not a parameter.`);
          }
        }
      }
      if (geometry.k === 'cut' && geometry.condition && !known.has(geometry.condition)) {
        throw new TineSourceError(geometry.line, `${geometry.condition} is not a parameter.`);
      }
    }
    if (statement.k === 'repeat') {
      for (const text of [statement.count.text, statement.pitch.text]) {
        for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9]*/g)) {
          if (match[0] !== 'pick' && !known.has(match[0])) {
            throw new TineSourceError(statement.line, `${match[0]} is not a parameter.`);
          }
        }
      }
    }
  }

  const tapeLength = countTapeOperations(statements);
  if (tapeLength > MAX_TAPE_OPERATIONS) {
    throw new TineSourceError(
      lines.length,
      `Tine allows at most ${MAX_TAPE_OPERATIONS} operations after operation 0.`,
    );
  }

  return { statements, parameters, source };
}

function countTapeOperations(statements: Statement[]): number {
  let count = 0;
  for (const statement of statements) {
    if (statement.k === 'repeat') count += 1 + statement.body.length;
    else count += 1;
  }
  return count;
}
