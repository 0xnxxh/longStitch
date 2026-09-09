import test from 'node:test';
import assert from 'node:assert/strict';
import { drawRect, adjustRect } from '../src/editor/regions.ts';

test('drawing in either direction keeps selection within the original image', () => {
  assert.deepEqual(drawRect({ x: 150, y: 80 }, { x: -10, y: 500 }, 320, 400), { x: 0, y: 80, width: 150, height: 320 });
  assert.deepEqual(drawRect({ x: 20, y: 40 }, { x: 80, y: 120 }, 320, 400), { x: 20, y: 40, width: 60, height: 80 });
});
test('moving cannot lose any part of the selection beyond image boundaries', () => {
  assert.deepEqual(adjustRect({ x: 270, y: 10, width: 50, height: 80 }, 'move', 100, -100, 320, 400), { x: 270, y: 0, width: 50, height: 80 });
});
test('resizing a corner preserves its opposite corner and cannot invert the box', () => {
  const r = { x: 20, y: 40, width: 60, height: 80 };
  assert.deepEqual(adjustRect(r, 'nw', -100, -100, 320, 400), { x: 0, y: 0, width: 80, height: 120 });
  assert.deepEqual(adjustRect(r, 'se', 500, 500, 320, 400), { x: 20, y: 40, width: 300, height: 360 });
  assert.deepEqual(adjustRect(r, 'nw', 100, 100, 320, 400), { x: 79, y: 119, width: 1, height: 1 });
});
