export interface DigestSubject {
  clusterId: string;
  title: string;
  publicDescription: string;
  publicItemCount: number;
  ownerHandle: string;
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]/g, ' ');
}

/** The one place that builds the follower digest body: exactly four CRLF-terminated lines. */
export function digestBody(subject: DigestSubject, publicBase: string): string {
  const lines = [
    oneLine(subject.title),
    oneLine(subject.publicDescription),
    `${subject.publicItemCount} public items by @${subject.ownerHandle}`,
    `${publicBase}/c/${subject.clusterId}`,
  ];
  return lines.map((line) => `${line}\r\n`).join('');
}
