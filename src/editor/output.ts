import type { Raster, Rect } from '../core/stitch.ts';
export interface Trim { top: number; bottom: number }

function validateTrim(height: number, trim: Trim) {
  if (!Number.isInteger(height) || height < 1 || !Number.isInteger(trim.top) || !Number.isInteger(trim.bottom) || trim.top < 0 || trim.bottom < 0 || trim.top + trim.bottom >= height) throw new Error('Invalid crop: keep at least one row');
}
export function outputBounds(height: number, originalHeight: number, trim: Trim) {
  validateTrim(originalHeight, trim);
  if (!Number.isInteger(height) || height < 1) throw new Error('Invalid crop height');
  const top = Math.min(height - 1, Math.round(trim.top * height / originalHeight));
  const end = Math.min(height, Math.max(top + 1, Math.round((originalHeight - trim.bottom) * height / originalHeight)));
  return { top, bottom: height - end, height: end - top };
}
export function cropRaster(image: Raster, trim: Trim): Raster {
  validateTrim(image.height, trim);
  if (!trim.top && !trim.bottom) return image;
  return { width: image.width, height: image.height - trim.top - trim.bottom, data: image.data.slice(trim.top * image.width * 4, (image.height - trim.bottom) * image.width * 4) };
}
// Redactions remain normalized to the uncropped content. Burn them into pixels
// before cropping, so changing an edge cannot move or uncover a private field.
export function finishImage(image: Raster, originalHeight: number, trim: Trim, redactions: Rect[]): Raster {
  const bounds = outputBounds(image.height, originalHeight, trim);
  for (const r of redactions) {
    const x0 = Math.max(0, Math.floor(r.x * image.width));
    const y0 = Math.max(0, Math.floor(r.y * image.height));
    const x1 = Math.min(image.width, Math.ceil((r.x + r.width) * image.width));
    const y1 = Math.min(image.height, Math.ceil((r.y + r.height) * image.height));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) image.data.set([21, 25, 28, 255], (y * image.width + x) * 4);
  }
  return cropRaster(image, bounds);
}
