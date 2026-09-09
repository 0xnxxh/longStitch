export interface Raster { width: number; height: number; data: Uint8ClampedArray }
export interface Rect { x: number; y: number; width: number; height: number }
export interface PairMatch {
  status: 'matched' | 'duplicate' | 'uncertain';
  offset: number;
  seam: number; // In the preceding screenshot, never an output crop margin.
  score: number;
  support: number;
  reason: string;
}
export interface Segment { image: number; sourceY: number; destinationY: number; height: number }

function validate(image: Raster) {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 8 || image.height < 16 || image.data.length !== image.width * image.height * 4) throw new Error('Invalid image dimensions or pixels');
}
function gray(image: Raster, x: number, y: number) {
  const i = (y * image.width + x) * 4;
  return (image.data[i] * 3 + image.data[i + 1] * 6 + image.data[i + 2]) / 10;
}

const COLS = 64;
// Small row descriptors keep full vertical resolution; only matching ignores
// the edge strip. Final pixels always come from full-width originals.
function describe(image: Raster) {
  const values = new Float32Array(image.height * COLS);
  for (let y = 0; y < image.height; y++) {
    for (let c = 0; c < COLS; c++) {
      const left = Math.floor(image.width * (.045 + c / COLS * .9));
      const right = Math.max(left + 1, Math.floor(image.width * (.045 + (c + 1) / COLS * .9)));
      let sum = 0;
      for (let x = left; x < right; x++) sum += gray(image, x, y);
      values[y * COLS + c] = sum / (right - left);
    }
  }
  return values;
}
function deviation(a: Float32Array, y: number, h: number) {
  let sum = 0, sq = 0, n = 0;
  for (let r = y; r < y + h; r += 3) for (let c = 0; c < COLS; c += 2) {
    const v = a[r * COLS + c]; sum += v; sq += v * v; n++;
  }
  return Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2));
}
function error(a: Float32Array, b: Float32Array, ay: number, by: number, h: number, stride = 3) {
  let sum = 0, n = 0;
  for (let r = 0; r < h; r += stride) for (let c = 0; c < COLS; c += 2) {
    sum += Math.abs(a[(ay + r) * COLS + c] - b[(by + r) * COLS + c]); n++;
  }
  return sum / n;
}

export function chooseSeam(a: Raster, b: Raster, offset: number): number {
  const ad = describe(a), bd = describe(b);
  const lo = Math.max(offset, Math.round(a.height * .055));
  const hi = Math.min(a.height, offset + b.height);
  const margin = Math.min(24, Math.floor((hi - lo) / 8));
  let best = Infinity, seam = Math.round((lo + hi) / 2);
  for (let y = lo + margin + 3; y < hi - margin - 3; y++) {
    const diff = error(ad, bd, y - 3, y - offset - 3, 7, 1);
    let gradient = 0;
    for (let c = 0; c < COLS; c++) gradient += Math.abs(ad[(y - 1) * COLS + c] - ad[y * COLS + c]);
    const cost = diff + gradient / COLS * .12 + Math.abs(y - (lo + hi) / 2) / Math.max(1, hi - lo) * .08;
    if (cost < best) { best = cost; seam = y; }
  }
  return seam;
}

export function matchPair(a: Raster, b: Raster): PairMatch {
  validate(a); validate(b);
  if (a.width !== b.width) throw new Error('Image width differs; use screenshots from the same device and zoom');
  const ad = describe(a), bd = describe(b);
  if (a.height === b.height && a.data.every((v, i) => v === b.data[i])) {
    return { status: 'duplicate', offset: 0, seam: a.height, score: 1, support: 0, reason: 'Duplicate screenshot' };
  }
  const window = Math.max(18, Math.min(48, Math.floor(Math.min(a.height, b.height) / 12)));
  const anchors: { offset: number; quality: number }[] = [];
  const step = Math.max(24, Math.floor(a.height / 28));
  for (let ay = Math.floor(a.height * .16); ay + window < a.height * .96; ay += step) {
    const contrast = deviation(ad, ay, window);
    if (contrast < 3) continue;
    let best = Infinity, byBest = 0;
    const maxBy = Math.min(b.height - window, ay - 5);
    for (let by = Math.floor(b.height * .04); by <= maxBy; by++) {
      const e = error(ad, bd, ay, by, window, 4);
      if (e < best) { best = e; byBest = by; }
    }
    for (let by = Math.max(0, byBest - 4); by <= Math.min(maxBy, byBest + 4); by++) {
      const e = error(ad, bd, ay, by, window, 2);
      if (e < best) { best = e; byBest = by; }
    }
    const quality = best / contrast;
    if (quality < .18 && ay - byBest >= 5) anchors.push({ offset: ay - byBest, quality });
  }
  const groups: { offset: number; count: number; quality: number }[] = [];
  for (const candidate of anchors.sort((a, b) => a.quality - b.quality)) {
    const group = groups.find(g => Math.abs(g.offset - candidate.offset) <= 2);
    if (group) { group.count++; group.quality += candidate.quality; }
    else groups.push({ offset: candidate.offset, count: 1, quality: candidate.quality });
  }
  function verify(d: number) {
    const start = Math.max(d + Math.floor(b.height * .08), Math.floor(a.height * .08));
    const end = Math.min(Math.floor(a.height * .92), d + Math.floor(b.height * .92));
    if (end - start < window) return Infinity;
    const contrast = deviation(ad, start, end - start);
    if (contrast < 3) return Infinity;
    const blocks: number[] = [];
    for (let y = start; y + 12 <= end; y += 12) blocks.push(error(ad, bd, y, y - d, 12, 2));
    blocks.sort((a, b) => a - b);
    const retained = blocks.slice(0, Math.max(2, Math.ceil(blocks.length * .75)));
    return retained.reduce((sum, e) => sum + e, 0) / retained.length / contrast;
  }
  const ranked = groups.filter(g => g.count >= 2).map(g => {
    let offset = g.offset, residual = Infinity;
    for (let d = Math.max(5, g.offset - 2); d <= g.offset + 2; d++) {
      const e = verify(d);
      if (e < residual) { residual = e; offset = d; }
    }
    return { ...g, offset, residual };
  }).sort((a, b) => a.residual - b.residual);
  const winner = ranked[0];
  if (!winner) return { status: 'uncertain', offset: Math.round(a.height * .65), seam: Math.round(a.height * .8), score: 0, support: 0, reason: 'No reliable overlap; adjust or add a screenshot' };
  const offset = winner.offset;
  const quality = winner.residual;
  const unique = !ranked[1] || quality + .03 < ranked[1].residual || quality < ranked[1].residual * .5;
  const confident = quality < .12 && unique;
  return {
    status: confident ? 'matched' : 'uncertain', offset, seam: chooseSeam(a, b, offset),
    score: Math.max(0, 1 - quality), support: winner.count,
    reason: confident ? 'Multiple content blocks agree' : 'Ambiguous overlap; inspect this seam',
  };
}

export function planSegments(images: Pick<Raster, 'width' | 'height'>[], pairs: PairMatch[]): { segments: Segment[]; starts: number[]; width: number; height: number } {
  if (!images.length || pairs.length !== images.length - 1) throw new Error('Invalid image or seam count');
  if (images.some(i => i.width !== images[0].width)) throw new Error('Image width differs');
  const starts = [0], cuts = [0];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.status === 'uncertain') throw new Error('Resolve uncertain seams before export');
    if (!Number.isInteger(p.offset) || p.offset < 0 || p.offset > images[i].height) throw new Error('Invalid offset');
    starts.push(starts[i] + p.offset);
    const cut = starts[i] + p.seam;
    if (!Number.isInteger(p.seam) || cut < cuts[i] || cut < starts[i + 1] || cut > Math.min(starts[i] + images[i].height, starts[i + 1] + images[i + 1].height)) throw new Error('Seams conflict; adjust the neighboring seams');
    cuts.push(cut);
  }
  const height = starts.at(-1)! + images.at(-1)!.height;
  if (height < cuts.at(-1)!) throw new Error('Seams exceed output bounds');
  cuts.push(height);
  const segments = images.map((_, i) => ({ image: i, sourceY: cuts[i] - starts[i], destinationY: cuts[i], height: cuts[i + 1] - cuts[i] }));
  return { segments, starts, width: images[0].width, height };
}

function contains(rect: Rect, x: number, y: number) { return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height; }

function donorContextMatches(source: Raster, donor: Raster, rect: Rect, delta: number) {
  let sum = 0, count = 0;
  // Verify adjacent real content before borrowing pixels. A coincident screen
  // coordinate in a fixed toolbar is not evidence of page coverage.
  for (let y = rect.y; y < rect.y + rect.height; y += 4) {
    if (y < 0 || y >= source.height || y + delta < 0 || y + delta >= donor.height) continue;
    for (const x of [rect.x - 3, rect.x - 8, rect.x + rect.width + 3]) {
      if (x < 0 || x >= source.width) continue;
      sum += Math.abs(gray(source, x, y) - gray(donor, x, y + delta)); count++;
    }
  }
  return count >= 3 && sum / count < 12;
}

export function compose(images: Raster[], pairs: PairMatch[], masks: Rect[][] = []) {
  images.forEach(validate);
  const plan = planSegments(images, pairs);
  if (plan.width * plan.height > 48_000_000) throw new Error('Output exceeds the 48 megapixel memory budget; use fewer screenshots or export smaller');
  const data = new Uint8ClampedArray(plan.width * plan.height * 4);
  for (const s of plan.segments) data.set(images[s.image].data.subarray(s.sourceY * plan.width * 4, (s.sourceY + s.height) * plan.width * 4), s.destinationY * plan.width * 4);
  let unresolvedPixels = 0, recoveredPixels = 0;
  for (const s of plan.segments) {
    const touched = new Set<number>();
    for (const rect of masks[s.image] ?? []) {
      for (let y = Math.max(s.sourceY, Math.floor(rect.y)); y < Math.min(s.sourceY + s.height, rect.y + rect.height); y++) {
        for (let x = Math.max(0, Math.floor(rect.x)); x < Math.min(plan.width, rect.x + rect.width); x++) {
          const gy = y + plan.starts[s.image], pixel = gy * plan.width + x;
          if (touched.has(pixel)) continue;
          touched.add(pixel);
          const donor = images.findIndex((image, j) => j !== s.image && gy >= plan.starts[j] && gy < plan.starts[j] + image.height && !(masks[j] ?? []).some(r => contains(r, x, gy - plan.starts[j])) && donorContextMatches(images[s.image], image, rect, plan.starts[s.image] - plan.starts[j]));
          if (donor < 0) { unresolvedPixels++; continue; }
          const source = ((gy - plan.starts[donor]) * plan.width + x) * 4;
          data.set(images[donor].data.subarray(source, source + 4), pixel * 4);
          recoveredPixels++;
        }
      }
    }
  }
  return { image: { width: plan.width, height: plan.height, data }, unresolvedPixels, recoveredPixels, segments: plan.segments };
}

// Detect only narrow, long, nearly uniform neutral marks with contrasting
// neighbors. This is a candidate mask, editable by the user, never a crop.
export function detectScrollbars(image: Raster): Rect[] {
  const masks: Rect[] = [];
  const left = Math.max(0, image.width - Math.max(8, Math.round(image.width * .025)));
  for (let x = left + 2; x < image.width - 1; x++) {
    let start = -1, previous = 0;
    for (let y = 1; y <= image.height; y++) {
      const v = y < image.height ? gray(image, x, y) : -1;
      const i = (y * image.width + x) * 4;
      const neutral = y < image.height && Math.max(image.data[i], image.data[i + 1], image.data[i + 2]) - Math.min(image.data[i], image.data[i + 1], image.data[i + 2]) < 18;
      const contrast = y < image.height && Math.abs(v - gray(image, Math.max(0, x - 4), y)) > 28;
      if (neutral && contrast && (start < 0 || Math.abs(v - previous) < 5)) { if (start < 0) start = y; }
      else {
        if (start >= 0 && y - start >= image.height * .025 && y - start <= image.height * .32) {
          const rect = { x: x - 1, y: Math.max(0, start - 2), width: Math.min(5, image.width - x + 1), height: y - start + 4 };
          if (!masks.some(r => Math.abs(r.x - rect.x) < 5 && Math.abs(r.y - rect.y) < 5)) masks.push(rect);
        }
        start = neutral && contrast ? y : -1;
      }
      previous = v;
    }
  }
  const merged: Rect[] = [];
  for (const rect of masks) {
    const existing = merged.find(r => Math.abs(r.y - rect.y) < 12 && Math.abs(r.height - rect.height) < 16 && Math.abs(r.x - rect.x) < Math.max(16, image.width * .02));
    if (!existing) { merged.push({ ...rect }); continue; }
    const right = Math.max(existing.x + existing.width, rect.x + rect.width);
    const bottom = Math.max(existing.y + existing.height, rect.y + rect.height);
    existing.x = Math.min(existing.x, rect.x); existing.y = Math.min(existing.y, rect.y);
    existing.width = right - existing.x; existing.height = bottom - existing.y;
  }
  return merged;
}
