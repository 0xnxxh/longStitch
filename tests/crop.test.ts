import test from 'node:test';
import assert from 'node:assert/strict';
import { outputBounds, cropRaster, finishImage } from '../src/editor/output.ts';
import { page } from './fixtures.ts';

test('top and bottom trim keep original full-width pixels in the requested interval', () => {
  const original = page(160, 800);
  const result = cropRaster(original, { top: 37, bottom: 63 });
  assert.equal(result.width, 160); assert.equal(result.height, 700);
  assert.deepEqual(result.data, original.data.slice(37 * 160 * 4, 737 * 160 * 4));
  assert.deepEqual(cropRaster(original, { top: 0, bottom: 0 }), original);
});
test('invalid trims cannot export an empty image or silently wrap negative indices', () => {
  const source = page(160, 100);
  for (const trim of [{ top: -1, bottom: 0 }, { top: 70, bottom: 30 }, { top: NaN, bottom: 0 }, { top: 1.5, bottom: 0 }]) assert.throws(() => cropRaster(source, trim), /crop/i);
  assert.equal(cropRaster(source, { top: 99, bottom: 0 }).height, 1);
});
test('reduced export maps original trim boundaries once, preserving a nonempty result', () => {
  assert.deepEqual(outputBounds(607, 1214, { top: 37, bottom: 63 }), { top: 19, bottom: 31, height: 557 });
  assert.deepEqual(outputBounds(400, 800, { top: 798, bottom: 1 }), { top: 399, bottom: 0, height: 1 });
});
test('redaction stays attached to the same original content after cropping and resizing', () => {
  const original = page(160, 800);
  const redactions = [{ x: .25, y: .1, width: .25, height: .1 }];
  const result = finishImage(original, 800, { top: 100, bottom: 50 }, redactions);
  assert.equal(result.height, 650);
  // Original rows 100–159 remain covered after the first 100 rows are removed.
  for (let y = 0; y < 60; y++) for (let x = 40; x < 80; x++) assert.deepEqual([...result.data.slice((y * 160 + x) * 4, (y * 160 + x) * 4 + 4)], [21, 25, 28, 255]);
  assert.deepEqual(result.data.slice(60 * 160 * 4), original.data.slice(160 * 160 * 4, 750 * 160 * 4));
  const small = finishImage(page(80, 400), 800, { top: 100, bottom: 50 }, redactions);
  assert.equal(small.height, 325);
  assert.deepEqual([...small.data.slice(20 * 4, 21 * 4)], [21, 25, 28, 255]);
});
