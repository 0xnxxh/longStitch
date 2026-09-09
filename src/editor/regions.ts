import type { Rect } from '../core/stitch.ts';
export type Point = { x: number; y: number };
export type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(n)));
export function drawRect(a: Point, b: Point, width: number, height: number): Rect {
  const left = clamp(Math.min(a.x, b.x), 0, width), top = clamp(Math.min(a.y, b.y), 0, height);
  return { x: left, y: top, width: clamp(Math.max(a.x, b.x), 0, width) - left, height: clamp(Math.max(a.y, b.y), 0, height) - top };
}
export function adjustRect(r: Rect, handle: Handle, dx: number, dy: number, width: number, height: number): Rect {
  if (handle === 'move') return { ...r, x: clamp(r.x + dx, 0, width - r.width), y: clamp(r.y + dy, 0, height - r.height) };
  const left = handle.includes('w') ? clamp(r.x + dx, 0, r.x + r.width - 1) : r.x;
  const top = handle.includes('n') ? clamp(r.y + dy, 0, r.y + r.height - 1) : r.y;
  const right = handle.includes('e') ? clamp(r.x + r.width + dx, left + 1, width) : r.x + r.width;
  const bottom = handle.includes('s') ? clamp(r.y + r.height + dy, top + 1, height) : r.y + r.height;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
