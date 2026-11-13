// Adapted from kit/modules/safe_redirect: the sign-in `next` value is honoured only when it is a same-site path.

const CONTROL = /[\u0000-\u001f\u007f]/;

function isSafe(target: string): boolean {
  return (
    target.startsWith('/') &&
    !target.startsWith('//') &&
    !target.includes('\\') &&
    !CONTROL.test(target) &&
    target.length <= 2048
  );
}

function isSafeRedirect(target: unknown): target is string {
  if (typeof target !== 'string') {
    return false;
  }
  let current = target;
  for (let round = 0; round < 4; round += 1) {
    if (!isSafe(current)) {
      return false;
    }
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        return true;
      }
      current = decoded;
    } catch {
      return false;
    }
  }
  return true;
}

export function safeNext(target: unknown, fallback: string): string {
  return isSafeRedirect(target) ? target : fallback;
}
