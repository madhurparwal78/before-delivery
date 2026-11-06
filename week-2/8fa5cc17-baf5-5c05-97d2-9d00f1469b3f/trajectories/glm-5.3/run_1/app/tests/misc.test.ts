import { homeDate, dateHeading, localMinuteToUtc, isZoneName } from "../src/shared/hometime.js";
import { sniffType, safeFilename } from "../src/shared/upload.js";
import { safeReturnAddress } from "../src/shared/return.js";

let failures = 0;
function check(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failures += 1;
    console.error(`FAIL ${name}\n  got  ${g}\n  want ${w}`);
  } else console.log(`ok   ${name}`);
}

// home clock
check("london date before midnight UTC", homeDate(new Date("2026-10-29T22:30:00Z"), "Europe/London"), "2026-10-29");
check("bst date rollover", homeDate(new Date("2026-10-15T23:30:00Z"), "Europe/London"), "2026-10-16");
check("sydney next day", homeDate(new Date("2026-10-29T15:30:00Z"), "Australia/Sydney"), "2026-10-30");
check("date heading", dateHeading("2026-10-29", "Europe/London"), "Thursday 29 October 2026");
check("date heading 2026-11-03", dateHeading("2026-11-03", "Europe/London"), "Tuesday 3 November 2026");
check("zone names", [isZoneName("Europe/London"), isZoneName("Not a zone!")], [true, false]);
const utc = localMinuteToUtc("2026-10-15", "18:30", "Europe/London", new Date());
check("local minute to utc (BST)", utc ? utc.toISOString() : null, "2026-10-15T17:30:00.000Z");
const utcWinter = localMinuteToUtc("2026-10-29", "18:30", "Europe/London", new Date());
check("local minute to utc (GMT)", utcWinter ? utcWinter.toISOString() : null, "2026-10-29T18:30:00.000Z");
const gap = localMinuteToUtc("2026-03-29", "01:30", "Europe/London", new Date());
check("dst gap refused", gap, null);

// upload
check("png sniff", sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])), "image/png");
check("jpeg sniff", sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
check("gif89a sniff", sniffType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), "image/gif");
check("webp sniff", sniffType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
check("pdf sniff", sniffType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), "application/pdf");
check("text refused", sniffType(new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f])), null);
check("filename path", safeFilename("C:\\dir\\scan 01.png"), "scan 01.png");
check("filename controls", safeFilename("a\u0000b.png"), "ab.png");
check("filename empty", safeFilename("   "), "attachment");
check("filename dots", safeFilename(".."), "attachment");
check("filename long", safeFilename("x".repeat(250) + ".png").length, 200);

// return address
check("safe return", safeReturnAddress("/o/abc-123"), "/o/abc-123");
check("safe return with query", safeReturnAddress("/graph?type=x"), "/graph?type=x");
check("protocol relative", safeReturnAddress("//evil.test/x"), null);
check("backslash", safeReturnAddress("/a\\b"), null);
check("scheme", safeReturnAddress("https://evil.test/"), null);
check("sign-in path", safeReturnAddress("/sign-in"), null);
check("api path", safeReturnAddress("/api/types"), null);
check("s path", safeReturnAddress("/s/abc"), null);
check("bare api", safeReturnAddress("/api"), null);
check("too long", safeReturnAddress("/" + "a".repeat(2001)), null);
check("exactly 2000", safeReturnAddress("/" + "a".repeat(1999)), "/" + "a".repeat(1999));
check("control char", safeReturnAddress("/a\u0000b"), null);

console.log(failures === 0 ? "ALL OK" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
