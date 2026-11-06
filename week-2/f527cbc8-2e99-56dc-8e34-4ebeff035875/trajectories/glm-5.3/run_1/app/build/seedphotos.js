import sharp from 'sharp';
import { putObject } from './storage.js';
const W = 900;
const H = 1200;
async function hoofDrawing(hoof) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#8a6f5a"/>
    <path d="M250,760 C250,900 350,980 450,980 C550,980 650,900 650,760 C650,650 550,600 450,600 C350,600 250,650 250,760 Z"
      fill="#c9a98a" stroke="#3a2c22" stroke-width="8"/>
    <path d="M250,760 C250,700 300,640 450,620 C600,640 650,700 650,760" fill="none" stroke="#3a2c22" stroke-width="6"/>
    <path d="M450,300 C300,330 220,430 220,560 L220,700 L300,700 L300,560 C300,470 360,400 450,380 C540,400 600,470 600,560 L600,700 L680,700 L680,560 C680,430 590,330 450,300 Z"
      fill="#d9bfa4" stroke="#3a2c22" stroke-width="8"/>
    <text x="450" y="1150" font-family="monospace" font-size="42" text-anchor="middle" fill="#2e231b">${hoof}</text>
  </svg>`;
    return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}
export async function storeSeedPhoto(tx, visitId, hoof) {
    const jpeg = await hoofDrawing(hoof);
    const key = `visits/${visitId}/${hoof}/after/seed_${hoof}.jpg`;
    await putObject(key, jpeg, 'image/jpeg');
    await putObject(`${key}.thumb.jpg`, await sharp(jpeg).resize({ width: 320 }).jpeg().toBuffer(), 'image/jpeg');
    return { size: jpeg.length, key };
}
