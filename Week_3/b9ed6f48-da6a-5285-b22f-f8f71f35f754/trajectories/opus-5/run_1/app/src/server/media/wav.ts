const SAMPLE_RATE = 22_050;

/**
 * Renders a narration bed: a procedural sequence of voiced tones, one per phrase of the
 * transcript, so every chapter ships several seconds of real audio.
 */
export function encodeNarration(seed: number, seconds: number): Buffer {
  const total = Math.round(SAMPLE_RATE * seconds);
  const samples = new Int16Array(total);
  const phraseLength = Math.round(SAMPLE_RATE * 0.75);
  for (let index = 0; index < total; index += 1) {
    const phrase = Math.floor(index / phraseLength);
    const withinPhrase = (index % phraseLength) / phraseLength;
    const base = 110 + ((seed * 7 + phrase * 13) % 9) * 11;
    const envelope = Math.sin(Math.PI * withinPhrase) ** 1.5;
    const time = index / SAMPLE_RATE;
    const voiced =
      Math.sin(2 * Math.PI * base * time) * 0.6 +
      Math.sin(2 * Math.PI * base * 2 * time) * 0.25 +
      Math.sin(2 * Math.PI * base * 3 * time) * 0.12;
    samples[index] = Math.round(voiced * envelope * 9000);
  }
  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) data.writeInt16LE(samples[index] as number, index * 2);

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
