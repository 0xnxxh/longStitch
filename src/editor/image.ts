import type { Raster } from '../core/stitch';

export async function decode(file: File, maxWidth?: number): Promise<Raster> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url;
    await img.decode();
    if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 16_000_000) throw new Error('IMAGE_TOO_LARGE');
    const scale = maxWidth ? Math.min(1, maxWidth / img.naturalWidth) : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const raster = { width: canvas.width, height: canvas.height, data };
    canvas.width = 0; canvas.height = 0;
    return raster;
  } finally { URL.revokeObjectURL(url); }
}

export function canvasFor(image: Raster): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  // A silent unsupported canvas size must not become an empty download.
  if (canvas.width !== image.width || canvas.height !== image.height) throw new Error('CANVAS_UNAVAILABLE');
  return canvas;
}

export async function toBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = .92): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob?.size ? resolve(blob) : reject(new Error('EXPORT_FAILED')), type, quality));
}
