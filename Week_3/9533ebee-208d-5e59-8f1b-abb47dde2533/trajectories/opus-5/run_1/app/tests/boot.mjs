// Boot behaviour: the server refuses to start when a required variable is
// missing or a configured value is invalid, naming the variable.
import { spawn } from 'node:child_process';

let fails = 0;
let checks = 0;
const chk = (label, got, want) => {
  checks += 1;
  const ok = String(got) === String(want);
  if (!ok) fails += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label} = ${String(got)}${ok ? '' : `  want ${String(want)}`}`,
  );
};

function boot(mutate) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    mutate(env);
    const child = spawn(process.execPath, ['/app/dist/server.js'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c) => {
      out += c.toString();
    });
    child.stderr.on('data', (c) => {
      out += c.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: 'timeout', out });
    }, 6000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

const REQUIRED = [
  'DATABASE_URL',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_FORCE_PATH_STYLE',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'SMTP_HOST',
  'SMTP_PORT',
  'MAIL_FROM',
  'WIREMOCK_URL',
  'SVIX_URL',
  'SVIX_API_KEY',
  'GOTENBERG_URL',
];

console.log('---- a missing required variable stops the server (DP-59)');
for (const name of REQUIRED) {
  const result = await boot((env) => {
    delete env[name];
  });
  chk(`${name} missing exits non-zero`, result.code !== 0 && result.code !== 'timeout', true);
  chk(`${name} is named in the message`, result.out.includes(name), true);
}

console.log('---- an invalid value stops the server (DP-59)');
const badZone = await boot((env) => {
  env['DESK_TIME_ZONE'] = 'Mars/Olympus';
});
chk(
  'an invalid time zone exits non-zero',
  badZone.code !== 0 && badZone.code !== 'timeout',
  true,
);
chk('DESK_TIME_ZONE is named', badZone.out.includes('DESK_TIME_ZONE'), true);

for (const name of [
  'GRACE_SECONDS',
  'STALENESS_SECONDS',
  'QUOTE_TTL_SECONDS',
  'ORACLE_POLL_SECONDS',
]) {
  const bad = await boot((env) => {
    env[name] = 'soon';
  });
  chk(`${name} must be a number`, bad.code !== 0 && bad.code !== 'timeout', true);
  chk(`${name} is named`, bad.out.includes(name), true);
  const zero = await boot((env) => {
    env[name] = '0';
  });
  chk(`${name} must be above zero`, zero.code !== 0 && zero.code !== 'timeout', true);
}
const badBool = await boot((env) => {
  env['S3_FORCE_PATH_STYLE'] = 'maybe';
});
chk(
  'S3_FORCE_PATH_STYLE must be a boolean',
  badBool.code !== 0 && badBool.code !== 'timeout',
  true,
);
chk('S3_FORCE_PATH_STYLE is named', badBool.out.includes('S3_FORCE_PATH_STYLE'), true);

console.log('---- optional variables have defaults (DP-59)');
const noOptional = await boot((env) => {
  delete env['DESK_TIME_ZONE'];
  delete env['GRACE_SECONDS'];
  delete env['STALENESS_SECONDS'];
  delete env['QUOTE_TTL_SECONDS'];
  delete env['ORACLE_POLL_SECONDS'];
  delete env['ORACLE_PATH_PREFIX'];
  env['APP_PUBLIC_PORT'] = '4199';
});
chk(
  'the server starts without the optional variables',
  noOptional.out.includes('listening on 0.0.0.0:4199'),
  true,
);

console.log('---- MAILPIT_URL is not needed (DP-59)');
const noMailpit = await boot((env) => {
  delete env['MAILPIT_URL'];
  env['APP_PUBLIC_PORT'] = '4198';
});
chk(
  'the server starts without MAILPIT_URL',
  noMailpit.out.includes('listening on 0.0.0.0:4198'),
  true,
);

console.log(fails === 0 ? `\nALL ${checks} PASS` : `\n${fails} of ${checks} FAILED`);
if (fails > 0) process.exitCode = 1;
