#!/usr/bin/env bash
# Records one narration file per chapter from the public-domain H. P. Paull
# translation held in src/shared/tale.ts, using the offline espeak-ng speech
# synthesiser and ffmpeg's Ogg Vorbis encoder. Run once; the resulting files
# are kept in the repository under public/narration.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/public/narration"
mkdir -p "$out"

cat > /tmp/press-dump-chapters.mjs <<NODE
import { passages } from '$root/src/shared/tale.ts';
const byChapter = new Map();
for (const passage of passages) {
  byChapter.set(passage.chapter, \`\${byChapter.get(passage.chapter) ?? ''} \${passage.text}\`.trim());
}
process.stdout.write(JSON.stringify(Object.fromEntries(byChapter)));
NODE

node --experimental-strip-types /tmp/press-dump-chapters.mjs > /tmp/press-chapters.json

python3 - "$out" <<'PY'
import json, pathlib, subprocess, sys

out = pathlib.Path(sys.argv[1])
chapters = json.load(open('/tmp/press-chapters.json'))
for chapter, text in chapters.items():
    wav = f'/tmp/press-{chapter}.wav'
    subprocess.run(['espeak-ng', '-v', 'en-gb', '-s', '148', '-p', '38', '-w', wav, text], check=True)
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis',
         '-q:a', '0', '-ar', '22050', '-ac', '1', str(out / f'{chapter}.ogg')],
        check=True,
    )
    print(chapter, (out / f'{chapter}.ogg').stat().st_size)
PY
