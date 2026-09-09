import sharp from 'sharp';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { matchPair, compose, detectScrollbars, type Raster } from '../src/core/stitch.ts';

await mkdir('artifacts', { recursive: true });
const files = (await readdir('samples')).filter(f => /\.png$/i.test(f)).sort();
const images: Raster[] = [];
for (const file of files) {
  const { data, info } = await sharp(`samples/${file}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  images.push({ width: info.width, height: info.height, data: new Uint8ClampedArray(data) });
}
const start = performance.now();
const pairs = images.slice(1).map((image, i) => matchPair(images[i], image));
const masks = images.map(detectScrollbars);
console.log(JSON.stringify({ files, pairs, masks, elapsedMs: Math.round(performance.now() - start) }, null, 2));
await writeFile('artifacts/sample-analysis.json', JSON.stringify({ files, pairs, masks }, null, 2));
if (pairs.some(p => p.status === 'uncertain')) {
  process.exitCode = 1;
} else {
  const result = compose(images, pairs, masks);
  await sharp(result.image.data, { raw: { width: result.image.width, height: result.image.height, channels: 4 } }).png().toFile('artifacts/samples-stitched.png');
  console.log(JSON.stringify({ width: result.image.width, height: result.image.height, unresolvedPixels: result.unresolvedPixels, recoveredPixels: result.recoveredPixels }));
  // Full-width seam crops make visual review possible without shrinking text.
  let startY = 0;
  for (let i = 0; i < pairs.length; i++) {
    const y = startY + pairs[i].seam;
    await sharp('artifacts/samples-stitched.png').extract({ left: 0, top: Math.max(0, y - 180), width: result.image.width, height: 360 }).png().toFile(`artifacts/seam-${i + 1}.png`);
    startY += pairs[i].offset;
  }
}
