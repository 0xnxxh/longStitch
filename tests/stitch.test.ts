import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPair, compose, detectScrollbars } from '../src/core/stitch.ts';
import { page, shot, paint } from './fixtures.ts';

test('overlapping screenshots preserve every source pixel and full width', () => {
  const source = page();
  const images = [shot(source, 0), shot(source, 263), shot(source, 514)];
  const pairs = images.slice(1).map((next, i) => matchPair(images[i], next));
  assert.deepEqual(pairs.map(p => p.status), ['matched', 'matched']);
  assert.deepEqual(pairs.map(p => p.offset), [263, 251]);
  const result = compose(images, pairs);
  assert.equal(result.image.width, 160);
  assert.equal(result.image.height, 994);
  assert.deepEqual(result.image.data, source.data.slice(0, 994 * 160 * 4));
});

test('fixed top and bottom UI is kept once without clipping content edges', () => {
  const source = page();
  const a = shot(source, 0), b = shot(source, 250);
  for (const image of [a, b]) {
    paint(image, { x: 0, y: 0, width: 160, height: 36 }, [9, 12, 15, 255]);
    paint(image, { x: 0, y: 440, width: 160, height: 40 }, [9, 12, 15, 255]);
  }
  const match = matchPair(a, b);
  assert.equal(match.status, 'matched');
  assert.equal(match.offset, 250);
  const result = compose([a, b], [match]);
  assert.deepEqual(result.image.data.slice(36 * 160 * 4, 690 * 160 * 4), source.data.slice(36 * 160 * 4, 690 * 160 * 4));
  assert.deepEqual(result.image.data.slice(0, 36 * 160 * 4), a.data.slice(0, 36 * 160 * 4));
  assert.deepEqual(result.image.data.slice(690 * 160 * 4), b.data.slice(440 * 160 * 4));
});

test('masked scrolling content is replaced only from real unoccluded coverage', () => {
  const source = page();
  const a = shot(source, 0), b = shot(source, 240);
  const rect = { x: 146, y: 270, width: 14, height: 30 };
  paint(a, rect);
  const match = matchPair(a, b);
  const result = compose([a, b], [match], [[rect], []]);
  assert.equal(result.image.width, 160);
  assert.deepEqual(result.image.data, source.data.slice(0, 720 * 160 * 4));
  assert.equal(result.unresolvedPixels, 0);
});

test('unrecoverable masked pixels stay original and are reported', () => {
  const source = page();
  const a = shot(source, 0), b = shot(source, 240);
  const rect = { x: 150, y: 80, width: 10, height: 20 };
  paint(a, rect);
  const result = compose([a, b], [matchPair(a, b)], [[rect], []]);
  assert.equal(result.unresolvedPixels, 200);
  assert.equal(result.image.data[(80 * 160 + 150) * 4], 200);
});

test('duplicates, unrelated images, and textureless overlaps do not silently delete content', () => {
  const a = shot(page(), 0);
  assert.equal(matchPair(a, a).status, 'duplicate');
  const mismatch = matchPair(a, shot(page(160, 1600, 789), 700));
  assert.notEqual(mismatch.status, 'matched');
  assert.throws(() => compose([a, a], [mismatch]), /resolve/i);
  const blank = shot(page(), 0); blank.data.fill(255);
  const almostBlank = shot(page(), 0); almostBlank.data.fill(254);
  assert.notEqual(matchPair(blank, almostBlank).status, 'matched');
});

test('different widths are rejected, never stretched', () => {
  assert.throws(() => matchPair(shot(page(160), 0), shot(page(170), 250)), /width/i);
});

test('thin right scrollbar detection does not mask the whole edge', () => {
  const image = shot(page(400), 0);
  paint(image, { x: 384, y: 0, width: 16, height: 480 }, [22, 28, 35, 255]);
  paint(image, { x: 395, y: 120, width: 3, height: 90 }, [150, 150, 150, 255]);
  const masks = detectScrollbars(image);
  assert.ok(masks.some(r => r.x <= 395 && r.x + r.width >= 398 && r.y <= 120 && r.y + r.height >= 210));
  assert.ok(masks.every(r => r.width < 15 && r.height < 150));
});

test('identical center with different edge content is not a duplicate', () => {
  const source = page(); const a = shot(source, 0), b = shot(source, 0);
  paint(b, { x: 156, y: 160, width: 4, height: 40 });
  assert.notEqual(matchPair(a, b).status, 'duplicate');
});

test('floating bottom controls are bypassed without losing underlying content', () => {
  const source = page(); const a = shot(source, 0), b = shot(source, 250);
  paint(a, { x: 30, y: 410, width: 100, height: 55 });
  paint(b, { x: 60, y: 450, width: 60, height: 25 });
  const pair = matchPair(a, b);
  assert.equal(pair.offset, 250);
  const result = compose([a, b], [pair]);
  assert.deepEqual(result.image.data.slice(0, 700 * 160 * 4), source.data.slice(0, 700 * 160 * 4));
});

test('periodic content with multiple equally plausible offsets requires review', () => {
  const source = page();
  for (let y = 24; y < source.height; y++) source.data.set(source.data.slice((y % 24) * 160 * 4, (y % 24 + 1) * 160 * 4), y * 160 * 4);
  assert.notEqual(matchPair(shot(source, 0), shot(source, 251)).status, 'matched');
});
