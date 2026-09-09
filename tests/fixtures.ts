import type { Raster, Rect } from '../src/core/stitch.ts';

// The source page is an independent oracle: screenshot offsets and occlusions
// are known before the matcher runs. Bright details extend to the right edge.
export function page(width = 160, height = 1600, seed = 19): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  let state = seed;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const i = (y * width + x) * 4;
      const ink = y % 24 < 13 && ((x + Math.floor(y / 24) * 7) % 31 < 22);
      data[i] = ink ? 50 + (state % 190) : 22;
      data[i + 1] = ink ? 70 + ((state >>> 8) % 150) : 28;
      data[i + 2] = ink ? 85 + ((state >>> 16) % 160) : 35;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

export function shot(source: Raster, offset: number, height = 480): Raster {
  return { width: source.width, height, data: source.data.slice(offset * source.width * 4, (offset + height) * source.width * 4) };
}

export function paint(image: Raster, rect: Rect, color = [200, 200, 200, 255]): void {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      image.data.set(color, (y * image.width + x) * 4);
    }
  }
}
