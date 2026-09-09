import { useEffect, useRef, useState } from 'react';
import { planSegments, type PairMatch, type Raster, type Rect } from '../core/stitch';
import { canvasFor, decode, toBlob } from './image';
import type { Job } from './worker';
import MaskEditor from './MaskEditor';

type Item = { id: string; file: File; url: string; width: number; height: number };
type Preview = { url: string; width: number; height: number; fullWidth: number; fullHeight: number; unresolved: number; recovered: number };
type WorkerResult = { pairs: PairMatch[]; masks: Rect[][]; image: Raster; unresolvedPixels: number; recoveredPixels: number };

export default function Editor({ lang }: { lang: 'zh' | 'en' }) {
  const zh = lang === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const [items, setItems] = useState<Item[]>([]);
  const [pairs, setPairs] = useState<PairMatch[]>([]);
  const [originalPairs, setOriginalPairs] = useState<PairMatch[]>([]);
  const [masks, setMasks] = useState<Rect[][]>([]);
  const [originalMasks, setOriginalMasks] = useState<Rect[][]>([]);
  const [maskSource, setMaskSource] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(0);
  const [zoom, setZoom] = useState(50);
  const [format, setFormat] = useState('image/png');
  const [scale, setScale] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [redacting, setRedacting] = useState(false);
  const [redactions, setRedactions] = useState<Rect[]>([]);
  const [draft, setDraft] = useState<Rect | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const worker = useRef<Worker | null>(null);
  const rejectJob = useRef<((e: Error) => void) | null>(null);
  const busyRef = useRef(false);
  const itemsRef = useRef(items); itemsRef.current = items;
  const previewRef = useRef(preview); previewRef.current = preview;
  const dragIndex = useRef<number | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => () => {
    worker.current?.terminate();
    itemsRef.current.forEach(i => URL.revokeObjectURL(i.url));
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
  }, []);

  function clearPreview() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
    previewRef.current = null; setPreview(null); setRedactions([]); setDraft(null);
  }
  function invalidate() { setPairs([]); setOriginalPairs([]); setMasks([]); setOriginalMasks([]); setMaskSource(0); clearPreview(); setDirty(false); setError(''); setNotice(''); }
  function cancel() {
    sequence.current++; worker.current?.terminate(); worker.current = null;
    rejectJob.current?.(new Error('CANCELLED')); rejectJob.current = null;
    busyRef.current = false; setBusy(''); setProgress(0);
  }
  function begin(label: string) { const id = ++sequence.current; busyRef.current = true; setBusy(label); setProgress(0); setError(''); setNotice(''); return id; }
  function finish(id: number) { if (sequence.current === id) { busyRef.current = false; setBusy(''); setProgress(0); } }
  function fail(e: unknown, id: number) {
    if (id !== sequence.current || (e instanceof Error && e.message === 'CANCELLED')) return;
    const message = e instanceof Error ? e.message : String(e);
    const translated: Record<string, string> = {
      IMAGE_TOO_LARGE: t('单张图片超过 1600 万像素。请先缩小后再添加。', 'An image exceeds 16 megapixels. Resize it before adding.'),
      CANVAS_UNAVAILABLE: t('浏览器无法创建这张图片，请选择较小的导出尺寸。', 'This browser cannot create this canvas. Choose a smaller export size.'),
      EXPORT_FAILED: t('图片编码失败，请尝试较小尺寸或 JPEG。', 'Image encoding failed. Try a smaller size or JPEG.'),
    };
    setError(translated[message] ?? message);
  }
  function runWorker(job: Job, id: number): Promise<WorkerResult> {
    if (id !== sequence.current) return Promise.reject(new Error('CANCELLED'));
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.current = w; rejectJob.current = reject;
      const end = () => { w.terminate(); if (worker.current === w) { worker.current = null; rejectJob.current = null; } };
      w.onerror = () => { end(); reject(new Error(t('后台处理失败，请减少图片后重试。', 'Background processing failed. Try fewer images.'))); };
      w.onmessage = event => {
        if (sequence.current !== id) { end(); reject(new Error('CANCELLED')); return; }
        if (event.data.kind === 'progress') { setProgress(event.data.value); return; }
        end();
        if (event.data.kind === 'error') reject(new Error(event.data.message)); else resolve(event.data);
      };
      // Ownership transfers to the worker, avoiding a second full input copy.
      w.postMessage(job, job.images.map(image => image.data.buffer as ArrayBuffer));
    });
  }
  async function readImages(id: number, width?: number) {
    const images: Raster[] = [];
    for (let i = 0; i < items.length; i++) {
      if (id !== sequence.current) throw new Error('CANCELLED');
      images.push(await decode(items[i].file, width));
      if (id !== sequence.current) throw new Error('CANCELLED');
      setProgress((i + 1) / items.length * .25);
    }
    return images;
  }
  async function addFiles(files: File[]) {
    if (!files.length || busyRef.current) return;
    const id = begin(t('正在读取截图', 'Reading screenshots'));
    const added: Item[] = [];
    try {
      let pixels = items.reduce((n, i) => n + i.width * i.height, 0);
      for (const file of files) {
        if (!/\.(png|jpe?g|webp)$/i.test(file.name) && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(t('支持 PNG、JPEG 和 WebP。HEIC 请先转换格式。', 'Use PNG, JPEG or WebP. Convert HEIC first.'));
        const image = await decode(file);
        if (id !== sequence.current) throw new Error('CANCELLED');
        pixels += image.width * image.height;
        if (pixels > 32_000_000) throw new Error(t('这批截图超过 3200 万像素。请减少数量或先缩小图片。', 'This batch exceeds 32 megapixels. Use fewer or smaller screenshots.'));
        added.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file), width: image.width, height: image.height });
      }
      invalidate(); setItems([...items, ...added]);
    } catch (e) { added.forEach(i => URL.revokeObjectURL(i.url)); fail(e, id); }
    finally { finish(id); if (input.current) input.current.value = ''; }
  }
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length) { event.preventDefault(); void addFiles(files); }
    };
    window.addEventListener('paste', paste); return () => window.removeEventListener('paste', paste);
  }, [items]);

  async function buildPreview(currentPairs: PairMatch[], currentMasks: Rect[][], id: number) {
    if (currentPairs.some(p => p.status === 'uncertain')) { clearPreview(); return; }
    const plan = planSegments(items, currentPairs);
    const targetWidth = Math.min(600, plan.width);
    const ratio = targetWidth / plan.width;
    const images = await readImages(id, targetWidth);
    const scaledPairs = currentPairs.map(p => ({ ...p, offset: Math.round(p.offset * ratio), seam: Math.round(p.seam * ratio) }));
    const scaledMasks = currentMasks.map(rs => rs.map(r => ({ x: Math.floor(r.x * ratio), y: Math.floor(r.y * ratio), width: Math.ceil(r.width * ratio), height: Math.ceil(r.height * ratio) })));
    const result = await runWorker({ kind: 'compose', images, pairs: scaledPairs, masks: scaledMasks }, id);
    const canvas = canvasFor(result.image);
    const blob = await toBlob(canvas); canvas.width = 0;
    if (id !== sequence.current) throw new Error('CANCELLED');
    clearPreview();
    const next = { url: URL.createObjectURL(blob), width: result.image.width, height: result.image.height, fullWidth: plan.width, fullHeight: plan.height, unresolved: result.unresolvedPixels, recovered: result.recoveredPixels };
    previewRef.current = next; setPreview(next); setDirty(false);
  }
  async function analyze() {
    const id = begin(t('正在寻找重叠区域', 'Finding overlaps'));
    invalidate();
    try {
      if (items.some(i => i.width !== items[0].width)) throw new Error(t('图片宽度不同。请使用同一设备、相同缩放的截图。', 'Image widths differ. Use the same device and zoom.'));
      const result = await runWorker({ kind: 'analyze', images: await readImages(id) }, id);
      setPairs(result.pairs); setOriginalPairs(result.pairs); setMasks(result.masks); setOriginalMasks(result.masks); setMaskSource(0); setSelected(0);
      await buildPreview(result.pairs, result.masks, id);
    } catch (e) { fail(e, id); } finally { finish(id); }
  }
  async function refreshPreview() {
    const id = begin(t('正在更新预览', 'Updating preview'));
    try { await buildPreview(pairs, masks, id); } catch (e) { fail(e, id); } finally { finish(id); }
  }
  function reorder(from: number, to: number) {
    if (busy || to < 0 || to >= items.length) return;
    const next = [...items]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
    invalidate(); setItems(next);
  }
  function editPair(index: number, key: 'offset' | 'seam', value: number) {
    const previous = pairs[index]; if (!previous || !Number.isFinite(value)) return;
    let offset = key === 'offset' ? Math.max(0, Math.min(items[index].height, Math.round(value))) : previous.offset;
    const lower = offset, upper = Math.min(items[index].height, offset + items[index + 1].height);
    const seam = key === 'seam' ? Math.max(lower, Math.min(upper, Math.round(value))) : Math.max(lower, Math.min(upper, Math.round((lower + upper) / 2)));
    setPairs(pairs.map((p, i) => i === index ? { ...p, offset, seam, status: 'matched', reason: 'Manually aligned' } : p));
    setDirty(true); setRedactions([]); setError('');
  }
  async function exportImage(share = false) {
    const id = begin(t('正在生成原图', 'Creating your image'));
    try {
      const width = Math.round(items[0].width * scale);
      const images = await readImages(id, width);
      const scaledPairs = pairs.map(p => ({ ...p, offset: Math.round(p.offset * scale), seam: Math.round(p.seam * scale) }));
      const scaledMasks = masks.map(rs => rs.map(r => ({ x: Math.floor(r.x * scale), y: Math.floor(r.y * scale), width: Math.ceil(r.width * scale), height: Math.ceil(r.height * scale) })));
      const result = await runWorker({ kind: 'compose', images, pairs: scaledPairs, masks: scaledMasks }, id);
      const canvas = canvasFor(result.image); const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#15191c';
      for (const r of redactions) ctx.fillRect(Math.floor(r.x * canvas.width), Math.floor(r.y * canvas.height), Math.ceil(r.width * canvas.width), Math.ceil(r.height * canvas.height));
      const blob = await toBlob(canvas, format); canvas.width = 0;
      if (id !== sequence.current) throw new Error('CANCELLED');
      const name = `longstitch-${items.length}.${format === 'image/png' ? 'png' : 'jpg'}`;
      const file = new File([blob], name, { type: format });
      if (share && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'LongStitch' });
      else {
        const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setNotice(result.unresolvedPixels ? t(`已导出。${result.unresolvedPixels} 个遮挡像素没有可用来源，保留了原图。`, `Exported. ${result.unresolvedPixels} occluded pixels have no donor and remain unchanged.`) : t('图片已生成，请在下载中查看。', 'Your image is ready. Check your downloads.'));
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) fail(e, id); } finally { finish(id); }
  }
  const selectedPair = pairs[selected];
  const unresolved = pairs.filter(p => p.status === 'uncertain').length;
  const changed = () => { setDirty(true); setRedactions([]); };
  function point(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }

  return <main className="workspace" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles([...event.dataTransfer.files]); } }}>
    <div className="workspace-heading"><div><span className="eyebrow">YOUR SCREENSHOTS, CONNECTED.</span><h1>{t('把碎片，连成完整。', 'Connect the whole story.')}</h1><p>{t('自动去重叠，细节不裁掉。所有处理都在你的设备上。', 'Remove overlaps. Keep the details. Everything happens on your device.')}</p></div><span className="privacy-pill"><span />{t('本地处理 · 无需上传', 'On-device · No uploads')}</span></div>
    <div className="editor-grid">
      <aside className="source-panel">
        <div className="panel-heading"><h2><span className="step">01</span>{t('你的截图', 'Your screenshots')}</h2><span className="count">{items.length}</span></div>
        <input ref={input} id="screenshots" aria-label={t('选择截图文件', 'Choose screenshot files')} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e => void addFiles([...e.target.files ?? []])} className="sr-only" disabled={!!busy} />
        <button className="upload-zone" onClick={() => input.current?.click()} disabled={!!busy}><span className="upload-plus">＋</span><strong>{items.length ? t('添加截图', 'Add screenshots') : t('选择截图', 'Choose screenshots')}</strong><span>{t('或拖放、粘贴到这里', 'or drop / paste them here')}</span><small>PNG · JPG · WEBP</small></button>
        {items.length > 0 && <div className="list-actions"><button disabled={!!busy || items.length < 2} onClick={() => { invalidate(); setItems([...items].reverse()); }}>{t('反转顺序', 'Reverse order')}</button><button disabled={!!busy} onClick={() => { cancel(); invalidate(); items.forEach(i => URL.revokeObjectURL(i.url)); setItems([]); }}>{t('清空', 'Clear')}</button></div>}
        <ol className="source-list">{items.map((item, i) => <li key={item.id} draggable={!busy} onDragStart={() => { dragIndex.current = i; }} onDragOver={e => e.preventDefault()} onDrop={e => { if (dragIndex.current !== null) { e.preventDefault(); e.stopPropagation(); reorder(dragIndex.current, i); dragIndex.current = null; } }} onDragEnd={() => { dragIndex.current = null; }}>
          <span className="source-number">{String(i + 1).padStart(2, '0')}</span><img src={item.url} alt={t(`第 ${i + 1} 张截图`, `Screenshot ${i + 1}`)} /><div className="source-meta"><strong title={item.file.name}>{item.file.name}</strong><span>{item.width} × {item.height}</span><div className="source-actions"><button disabled={!!busy || i === 0} onClick={() => reorder(i, i - 1)} aria-label={t(`上移截图 ${i + 1}`, `Move screenshot ${i + 1} up`)}>↑</button><button disabled={!!busy || i === items.length - 1} onClick={() => reorder(i, i + 1)} aria-label={t(`下移截图 ${i + 1}`, `Move screenshot ${i + 1} down`)}>↓</button><button disabled={!!busy} onClick={() => { invalidate(); URL.revokeObjectURL(item.url); setItems(items.filter(x => x.id !== item.id)); }} aria-label={t(`移除截图 ${i + 1}`, `Remove screenshot ${i + 1}`)}>×</button></div></div>
        </li>)}</ol>
        <div className="source-bottom"><button className="primary stitch-button" disabled={items.length < 2 || !!busy} onClick={() => void analyze()}>{t('自动拼接', 'Stitch screenshots')} <span>↗</span></button><p>{t('按从上到下的顺序，选择有重叠内容的截图。', 'Arrange top to bottom. Consecutive images need shared content.')}</p></div>
      </aside>
      <section className="result-panel" aria-label={t('拼接结果', 'Stitched result')}>
        <div className="result-toolbar"><h2><span className="step">02</span>{t('完整长图', 'The full picture')}</h2>{preview && <div className="zoom-control"><label htmlFor="zoom">{t('缩放', 'Zoom')}</label><input id="zoom" type="range" min="20" max="100" step="10" value={zoom} onChange={e => setZoom(+e.target.value)} /><span>{zoom}%</span></div>}</div>
        {error && <div className="message error" role="alert">{error}</div>}
        {notice && <div className="message success" role="status">{notice}</div>}
        {busy && <div className="message processing" role="status"><span>{busy}…</span><progress max="1" value={progress} /><button onClick={cancel}>{t('取消', 'Cancel')}</button></div>}
        {!!unresolved && <div className="message warning" role="status">{t(`${unresolved} 条接缝需要确认。请在下方调整位移，或补充一张有重叠的截图。`, `${unresolved} seams need review. Adjust their alignment below or add an overlapping screenshot.`)}</div>}
        {dirty && <div className="message warning">{t('调整尚未应用。更新预览后再导出。', 'Changes are not applied. Update the preview before exporting.')}<button disabled={!!busy || !!unresolved} onClick={() => void refreshPreview()}>{t('更新预览', 'Update preview')}</button></div>}
        <div className={`preview-stage ${preview ? 'has-result' : ''}`}>
          {preview ? <div className="preview-scroll"><div className={`image-sheet ${redacting ? 'redacting' : ''}`} style={{ width: `${zoom}%`, maxWidth: preview.fullWidth }} onPointerDown={e => { if (!redacting || dirty || busy) return; e.currentTarget.setPointerCapture(e.pointerId); const p = point(e); pointerStart.current = p; setDraft({ ...p, width: 0, height: 0 }); }} onPointerMove={e => { if (!pointerStart.current) return; const p = point(e), a = pointerStart.current; setDraft({ x: Math.min(p.x, a.x), y: Math.min(p.y, a.y), width: Math.abs(p.x - a.x), height: Math.abs(p.y - a.y) }); }} onPointerUp={() => { if (draft && draft.width > .002 && draft.height > .001) setRedactions([...redactions, draft]); setDraft(null); pointerStart.current = null; }} onPointerCancel={() => { setDraft(null); pointerStart.current = null; }}>
            <img src={preview.url} alt={t('长截图预览，导出保留原始分辨率', 'Stitched preview; export preserves original resolution')} draggable={false} />
            {[...redactions, ...(draft ? [draft] : [])].map((r, i) => <span key={i} className="redaction" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` }} />)}
          </div></div> : <div className="empty-result"><div className="paper-stack" aria-hidden="true"><div><i /><i /><i /></div><div><i /><i /><i /><i /></div><span>↕</span></div><h3>{t('完整故事，从这里开始', 'Your whole story starts here')}</h3><p>{t('添加至少两张截图，我们会找到它们之间的重叠。', 'Add at least two screenshots. We’ll find where they connect.')}</p><div className="empty-steps"><span>1. {t('选择截图', 'Choose')}</span><b>→</b><span>2. {t('检查接缝', 'Review')}</span><b>→</b><span>3. {t('保存长图', 'Save')}</span></div></div>}
        </div>
        {preview && <div className="export-bar"><div className="output-details"><strong>{preview.fullWidth} × {preview.fullHeight}</strong><span>{t('原图尺寸 · 全宽保留', 'Original size · Full width')}</span></div><button className={redacting ? 'active' : ''} disabled={dirty || !!busy} onClick={() => setRedacting(!redacting)} aria-pressed={redacting}>{redacting ? t('退出遮挡', 'Finish redacting') : t('遮挡隐私', 'Redact')}</button>{!!redactions.length && <button onClick={() => setRedactions(redactions.slice(0, -1))} disabled={!!busy}>{t('撤销遮挡', 'Undo redaction')}</button>}<select aria-label={t('导出格式', 'Export format')} value={format} onChange={e => setFormat(e.target.value)}><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option></select><select aria-label={t('导出尺寸', 'Export size')} value={scale} onChange={e => setScale(+e.target.value)}><option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option></select><button className="primary" disabled={!!busy || dirty || !!unresolved} onClick={() => void exportImage()}>{t('保存长图', 'Save image')} ↓</button>{typeof navigator !== 'undefined' && !!navigator.share && <button disabled={!!busy || dirty} onClick={() => void exportImage(true)}>{t('分享', 'Share')}</button>}</div>}
        {redacting && <p className="inline-note">{t('在预览图上拖出矩形，实体色遮挡会写入导出图片。调整接缝会清除已有遮挡，请重新检查。', 'Drag a rectangle over the preview. Redactions are baked into the export. Realigning clears redactions; review them again.')}</p>}
        {!!preview?.unresolved && <p className="inline-note">{t('部分遮挡区域没有可用的原图覆盖，已保留原样。补截图或手动调整后重试。', 'Some occlusions lack clean source coverage and remain unchanged. Add a screenshot or adjust them.')}</p>}
      </section>
    </div>
    {!!pairs.length && <section className="seam-panel"><div className="panel-heading"><h2><span className="step">03</span>{t('检查与微调', 'Review & refine')}</h2><span>{t('每个接缝都在你的掌控中', 'Every seam stays in your control')}</span></div><div className="seam-tabs" role="group" aria-label={t('选择接缝', 'Select seam')}>{pairs.map((p, i) => <button key={i} className={`${selected === i ? 'active' : ''} ${p.status === 'uncertain' ? 'needs-review' : ''}`} onClick={() => setSelected(i)}>{i + 1} → {i + 2} <span>{p.status === 'uncertain' ? t('需调整', 'Review') : p.status === 'duplicate' ? t('重复', 'Duplicate') : t('已对齐', 'Aligned')}</span></button>)}</div>
      {selectedPair && <div className="seam-editor"><SeamView first={items[selected]} second={items[selected + 1]} pair={selectedPair} label={t('接缝局部预览', 'Seam close-up')} /><div className="seam-controls"><p>{t('上图下半部与下图上半部透明叠加。文字应重合；横线是实际接缝。', 'The two screenshots overlap transparently. Text should align; the line marks the join.')}</p><label>{t('向下位移（像素）', 'Vertical offset (pixels)')}<input type="number" min="0" max={items[selected].height} value={selectedPair.offset} disabled={!!busy} onChange={e => editPair(selected, 'offset', +e.target.value)} /></label><input aria-label={t('调整重叠', 'Adjust overlap')} type="range" min="0" max={items[selected].height} value={selectedPair.offset} disabled={!!busy} onChange={e => editPair(selected, 'offset', +e.target.value)} /><label>{t('接缝在上图的位置', 'Seam position in first image')}<input type="number" min={selectedPair.offset} max={Math.min(items[selected].height, selectedPair.offset + items[selected + 1].height)} value={selectedPair.seam} disabled={!!busy} onChange={e => editPair(selected, 'seam', +e.target.value)} /></label><div className="row"><button disabled={!!busy} onClick={() => { setPairs(pairs.map((p, i) => i === selected ? originalPairs[i] : p)); changed(); }}>{t('恢复自动结果', 'Reset alignment')}</button><button disabled={!!busy} onClick={() => editPair(selected, 'offset', items[selected].height)}>{t('直接连接，不去重', 'Join without overlap')}</button><button disabled={!!busy || selectedPair.status !== 'uncertain'} onClick={() => { setPairs(pairs.map((p, i) => i === selected ? { ...p, status: 'matched', reason: 'Manually confirmed' } : p)); changed(); }}>{t('确认当前接缝', 'Confirm this seam')}</button></div><button className="primary" disabled={!!busy || !!unresolved} onClick={() => void refreshPreview()}>{t('应用调整并预览', 'Apply & preview')}</button></div></div>}
      <details className="occlusion-settings"><summary>{t('滚动条与常驻元素：调整遮挡范围', 'Scrollbars & fixed controls: edit recovery regions')}</summary>
        <div className="mask-source-picker"><label>{t('选择要调整的截图', 'Choose a screenshot')}<select aria-label={t('选择要调整的截图', 'Choose a screenshot')} value={maskSource} disabled={!!busy} onChange={e => setMaskSource(+e.target.value)}>{items.map((item, i) => <option key={item.id} value={i}>{i + 1}. {item.file.name}</option>)}</select></label><span>{t('只恢复有真实来源的像素，没有来源时保留原样。', 'Only real covered pixels are restored. Missing content stays unchanged.')}</span></div>
        <MaskEditor key={items[maskSource].id} source={items[maskSource]} masks={masks[maskSource] ?? []} originalMasks={originalMasks[maskSource] ?? []} disabled={!!busy} zh={zh} onChange={next => { setMasks(masks.map((list, i) => i === maskSource ? next : list)); changed(); }} />
        <div className="region-apply"><span>{dirty ? t('范围已修改，应用后查看长图效果。', 'Regions changed. Apply them to update the result.') : t('当前范围已应用。', 'Current regions are applied.')}</span><button className="primary" disabled={!!busy || !!unresolved || !dirty} onClick={() => void refreshPreview()}>{t('应用范围并预览', 'Apply regions & preview')}</button></div>
      </details>
    </section>}
    <div className="workspace-help"><span>↳</span><p>{t('小提示：连续截图保留约 20–40% 重叠。等待页面稳定，避免切换缩放。遇到常驻栏，不必手动裁掉整条边缘。', 'Tip: leave about 20–40% overlap. Wait for the page to settle and keep the same zoom. You don’t need to crop entire edges to handle fixed controls.')}</p></div>
  </main>;
}

function SeamView({ first, second, pair, label }: { first: Item; second: Item; pair: PairMatch; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    const a = new Image(), b = new Image(); a.src = first.url; b.src = second.url;
    Promise.all([a.decode(), b.decode()]).then(() => {
      if (!alive || !canvas.current) return;
      const c = canvas.current; const width = Math.min(first.width, 900), ratio = width / first.width;
      c.width = width; c.height = 260;
      const ctx = c.getContext('2d'); if (!ctx) return;
      ctx.fillStyle = '#dcdedb'; ctx.fillRect(0, 0, width, 260);
      ctx.drawImage(a, 0, 130 - pair.seam * ratio, first.width * ratio, first.height * ratio);
      ctx.globalAlpha = .5; ctx.drawImage(b, 0, 130 + (pair.offset - pair.seam) * ratio, second.width * ratio, second.height * ratio); ctx.globalAlpha = 1;
      ctx.strokeStyle = '#eb633d'; ctx.setLineDash([8, 5]); ctx.beginPath(); ctx.moveTo(0, 130); ctx.lineTo(width, 130); ctx.stroke();
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [first.url, second.url, pair]);
  return <div className="seam-view"><span>{label}</span>{failed ? <p role="alert">{label} — {label.startsWith('接缝') ? '图片读取失败，请重新添加。' : 'Image could not be loaded. Add it again.'}</p> : <canvas ref={canvas} role="img" aria-label={label} />}</div>;
}
