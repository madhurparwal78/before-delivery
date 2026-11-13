// Every published sentence, one spelling each.

export function m01(): string { return `Given cells can't be changed.`; }
export function m02(): string { return `Hinted cells can't be changed.`; }
export function m03(): string { return `Correct entries can't be changed.`; }
export function m04(): string { return `Nothing to undo.`; }
export function m05(): string { return `Nothing to redo.`; }
export function m06(r: number, c: number, d: number): string { return `Row ${r}, column ${c}, ${d}.`; }
export function m07(r: number, c: number, d: number, n: number, limit: number): string { return `Row ${r}, column ${c}, ${d}, wrong. Mistakes ${n} of ${limit}.`; }
export function m08add(r: number, c: number, d: number): string { return `Note ${d} added to row ${r}, column ${c}.`; }
export function m08remove(r: number, c: number, d: number): string { return `Note ${d} removed from row ${r}, column ${c}.`; }
export function m09(r: number, c: number): string { return `Row ${r}, column ${c} erased.`; }
export function m10Undo(): string { return `Undone.`; }
export function m10Redo(): string { return `Redone.`; }
export function m11(limit: number): string { return `You made ${limit} mistakes.`; }
export function m12(limit: number): string { return `You made ${limit} mistakes. Your second chance is used.`; }
export function m13(limit: number): string { return `Game over. ${limit} mistakes.`; }
export function m14(): string { return `Your game is paused.`; }
export function m15Pause(): string { return `Paused.`; }
export function m15Resume(): string { return `Resumed.`; }
export function m16(r: number, c: number, d: number, left: number): string { return `Hint: row ${r}, column ${c} is ${d}. Hints left ${left}.`; }
export function m17(): string { return `No hints left.`; }
export function m18(time: string, mistakes: number, hints: number, scoreValue: number): string {
  const m = mistakes === 1 ? '1 mistake' : `${mistakes} mistakes`;
  const h = hints === 1 ? '1 hint' : `${hints} hints`;
  return `Solved in ${time} with ${m} and ${h}. Score ${scoreValue}.`;
}
export function m19(time: string, scoreValue: number): string { return `Solved in ${time}. Score ${scoreValue}.`; }
export function m20(code: string): string { return `This game could not be verified (${code}). It was not counted.`; }
export function m21(): string { return `Your game wasn't saved. It will be saved with your next move.`; }
export function m22(): string { return `Checking your game.`; }
export function m23On(): string { return `Notes on.`; }
export function m23Off(): string { return `Notes off.`; }
export function m24(n: number, limit: number): string { return `Second chance. Mistakes ${n} of ${limit}.`; }
export function m25(): string { return `This game isn't in the collection.`; }
export function m26(): string { return `This page isn't in the collection.`; }
export function m27(): string { return `Confirm your email to join duels.`; }
export function m28(): string { return `Too many tries. Wait a minute and try again.`; }
export function m29(): string { return `No room has that code.`; }
export function m30(): string { return `Hints are off in duels.`; }
export function m31(): string { return `Duels can't be paused.`; }
export function m32(): string { return `Waiting for a second player.`; }
export function m33(n: number): string { return `Starting in ${n}`; }
export function m34(time: string): string { return `You win! You finished first in ${time}.`; }
export function m35(name: string, time: string): string { return `${name} wins. They finished first in ${time}.`; }
export function m36(): string { return `It's a tie.`; }
export function m37You(limit: number, name: string): string { return `You're out: ${limit} mistakes. ${name} wins.`; }
export function m37Opponent(name: string): string { return `${name} is out. You win.`; }
export function m38(name: string): string { return `${name} left the duel. You win.`; }
export function m39Reconnecting(name: string): string { return `${name} is reconnecting.`; }
export function m39Back(name: string): string { return `${name} is back.`; }
export function m40(): string { return `Live duels are unavailable right now. Solo games and the daily challenge still work.`; }
export function m41(): string { return `This room already has two players.`; }
export function m42(): string { return `The duel has started.`; }
export function m43(name: string, rank: number): string { return `${name} finished at rank ${rank}.`; }
export function m44(): string { return `Confirm your email to join duels and the leaderboard.`; }
export function m45(): string { return `Confirm your email to appear on the leaderboard.`; }
export function m46(): string { return `A new confirmation email is on its way.`; }
export function m47(): string { return `Live updates are paused. Reload to see new results.`; }
export function m48(): string { return `No one has finished this daily yet.`; }
export function m49(): string { return `Your account is ready, but we couldn't send the confirmation email. Use Send again in a minute.`; }
export function m50(): string { return `We couldn't send email right now. Try again in a minute.`; }
export function m51(): string { return `If that email has an account, a reset link is on its way.`; }
export function m52(): string { return `Email or password is incorrect.`; }
export function m53Verified(): string { return `Your email is confirmed.`; }
export function m53Reset(): string { return `Your password is saved.`; }
export function m54Used(): string { return `This confirmation link was already used.`; }
export function m54Expired(): string { return `This confirmation link has expired.`; }
export function m54NotFound(): string { return `This confirmation link isn't valid.`; }
export function m55Used(): string { return `This reset link was already used.`; }
export function m55Expired(): string { return `This reset link has expired.`; }
export function m55NotFound(): string { return `This reset link isn't valid.`; }
export function m56(): string { return `Something went wrong at the atelier. Try again.`; }
export function m57(): string { return `The atelier is preparing your page.`; }
export function m58(): string { return `No finished games yet. The first one is waiting.`; }
export function m59Signup(): string { return `Creating your account.`; }
export function m59Signin(): string { return `Signing you in.`; }
export function m59Reset(): string { return `Sending the reset link.`; }
export function m59Room(): string { return `Opening the room.`; }
export function m60Email(): string { return `Enter a valid email address.`; }
export function m60EmailTaken(): string { return `That email already has an account.`; }
export function m60NameLength(): string { return `Use 3 to 20 characters.`; }
export function m60NameTaken(): string { return `That display name is taken.`; }
export function m60Password(): string { return `Use at least 10 characters.`; }
export function m61(): string { return `The atelier's records are out of reach. Try again in a minute.`; }
