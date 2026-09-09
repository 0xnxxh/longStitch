import { compose, detectScrollbars, matchPair, type PairMatch, type Raster, type Rect } from '../core/stitch';

import { finishImage, type Trim } from './output';

export interface Job { kind: 'analyze' | 'compose'; images: Raster[]; pairs?: PairMatch[]; masks?: Rect[][]; output?: { originalHeight: number; trim: Trim; redactions: Rect[] } }
self.onmessage = (event: MessageEvent<Job>) => {
  try {
    const job = event.data;
    if (job.kind === 'analyze') {
      const pairs: PairMatch[] = [];
      for (let i = 0; i < job.images.length - 1; i++) {
        pairs.push(matchPair(job.images[i], job.images[i + 1]));
        self.postMessage({ kind: 'progress', value: (i + 1) / (job.images.length - 1) });
      }
      self.postMessage({ kind: 'result', pairs, masks: job.images.map(detectScrollbars) });
    } else {
      const result = compose(job.images, job.pairs!, job.masks);
      const image = job.output ? finishImage(result.image, job.output.originalHeight, job.output.trim, job.output.redactions) : result.image;
      self.postMessage({ kind: 'result', ...result, image }, { transfer: [image.data.buffer] });
    }
  } catch (error) { self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) }); }
};
