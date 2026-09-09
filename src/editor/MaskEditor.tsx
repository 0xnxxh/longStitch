import { useRef, useState } from 'react';
import type { Rect } from '../core/stitch';
import { adjustRect, drawRect, type Handle, type Point } from './regions';

type Source = { url: string; width: number; height: number; file: File };
type Gesture = { index: number; handle: Handle | 'draw'; start: Point; original: Rect; current: Rect; pointerId: number };

export default function MaskEditor({ source, masks, originalMasks, onChange, disabled, zh }: {
  source: Source; masks: Rect[]; originalMasks: Rect[]; onChange: (masks: Rect[]) => void; disabled: boolean; zh: boolean;
}) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const [selected, setSelected] = useState<number | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [history, setHistory] = useState<Rect[][]>([]);
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  function commit(next: Rect[]) { setHistory(h => [...h.slice(-19), masks]); onChange(next); }
  function point(e: React.PointerEvent): Point {
    const bounds = surface.current!.getBoundingClientRect();
    return { x: (e.clientX - bounds.left) / bounds.width * source.width, y: (e.clientY - bounds.top) / bounds.height * source.height };
  }
  function start(e: React.PointerEvent, index: number, handle: Gesture['handle']) {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0) || gesture.current) return;
    e.preventDefault(); e.stopPropagation();
    const p = point(e), original = masks[index] ?? { x: p.x, y: p.y, width: 0, height: 0 };
    gesture.current = { index, handle, start: p, original, current: original, pointerId: e.pointerId };
    surface.current!.setPointerCapture(e.pointerId); setSelected(index); setDraft(original);
  }
  function update(e: React.PointerEvent) {
    const g = gesture.current; if (!g || g.pointerId !== e.pointerId) return;
    const p = point(e);
    g.current = g.handle === 'draw' ? drawRect(g.start, p, source.width, source.height) : adjustRect(g.original, g.handle, p.x - g.start.x, p.y - g.start.y, source.width, source.height);
    setDraft(g.current);
  }
  function end(e: React.PointerEvent, cancelled = false) {
    const g = gesture.current; if (!g || g.pointerId !== e.pointerId) return;
    if (!cancelled) update(e);
    if (!cancelled && g.current.width >= 1 && g.current.height >= 1) {
      if (g.handle === 'draw') { commit([...masks, g.current]); setDrawing(false); }
      else if (JSON.stringify(g.current) !== JSON.stringify(g.original)) commit(masks.map((r, i) => i === g.index ? g.current : r));
    }
    if (surface.current?.hasPointerCapture(e.pointerId)) surface.current.releasePointerCapture(e.pointerId);
    gesture.current = null; setDraft(null);
  }
  function keyboard(e: React.KeyboardEvent, index: number, handle: Handle) {
    if (disabled) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); commit(masks.filter((_, i) => i !== index)); setSelected(null); return; }
    const direction: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const d = direction[e.key]; if (!d) return;
    e.preventDefault(); const step = e.shiftKey ? 10 : 1;
    commit(masks.map((r, i) => i === index ? adjustRect(r, handle, d.x * step, d.y * step, source.width, source.height) : r));
  }
  const visible = masks.map((r, i) => i === gesture.current?.index && draft ? draft : r);
  if (gesture.current?.handle === 'draw' && draft) visible.push(draft);
  const corners: Handle[] = ['nw', 'ne', 'sw', 'se'];
  const cornerName = { nw: t('左上', 'top left'), ne: t('右上', 'top right'), sw: t('左下', 'bottom left'), se: t('右下', 'bottom right'), move: '' };
  return <div className="mask-editor">
    <div className="mask-toolbar"><button className={drawing ? 'active' : ''} aria-pressed={drawing} disabled={disabled} onClick={() => setDrawing(!drawing)}>{drawing ? t('退出框选', 'Stop drawing') : t('框选新范围', 'Draw a region')}</button><button disabled={disabled} onClick={() => { commit([...masks, { x: Math.round(source.width * .3), y: Math.round(source.height * .35), width: Math.round(source.width * .4), height: Math.round(source.height * .12) }]); setSelected(masks.length); }}>{t('添加矩形', 'Add rectangle')}</button><button disabled={disabled || !history.length} onClick={() => { onChange(history.at(-1)!); setHistory(history.slice(0, -1)); setSelected(null); }}>{t('撤销范围修改', 'Undo region change')}</button><button disabled={disabled} onClick={() => { commit(originalMasks); setSelected(null); }}>{t('恢复自动识别', 'Reset detected regions')}</button><label>{t('原图放大', 'Image zoom')}<select aria-label={t('原图放大', 'Image zoom')} value={zoom} onChange={e => setZoom(+e.target.value)}><option value="100">100%</option><option value="200">200%</option><option value="300">300%</option></select></label></div>
    <p className="region-instruction">{drawing ? t('在截图上拖出矩形，松开后完成框选。', 'Drag a rectangle on the screenshot, then release.') : t('拖动矩形移动范围，拖动四角调整大小。可用方向键微调，Shift 加速；空白处可滚动。', 'Move the rectangle or drag its corners to resize. Arrow keys fine-tune; Shift moves faster. Scroll on empty areas.')}</p>
    <div className="mask-workspace"><div className="mask-viewport"><div ref={surface} className={`mask-surface ${drawing ? 'drawing' : ''}`} style={{ width: `${zoom}%` }} onPointerDown={e => { if (drawing) start(e, masks.length, 'draw'); }} onPointerMove={update} onPointerUp={e => end(e)} onPointerCancel={e => end(e, true)}>
      <img src={source.url} alt={t('在原截图上调整待恢复范围', 'Adjust recovery regions on the original screenshot')} draggable={false} />
      {visible.map((r, i) => <div key={i} className={`mask-box ${selected === i ? 'selected' : ''}`} style={{ left: `${r.x / source.width * 100}%`, top: `${r.y / source.height * 100}%`, width: `${r.width / source.width * 100}%`, height: `${r.height / source.height * 100}%` }}>
        <button type="button" className="mask-move" aria-label={t(`移动范围 ${i + 1}`, `Move region ${i + 1}`)} disabled={disabled} onFocus={() => setSelected(i)} onPointerDown={e => start(e, i, 'move')} onKeyDown={e => keyboard(e, i, 'move')}><span>{i + 1}</span></button>
        {selected === i && corners.map(corner => <button key={corner} className={`mask-handle ${corner}`} aria-label={t(`调整范围 ${i + 1} ${cornerName[corner]}角`, `Resize region ${i + 1} ${cornerName[corner]} corner`)} disabled={disabled} onPointerDown={e => start(e, i, corner)} onKeyDown={e => keyboard(e, i, corner)} />)}
      </div>)}
    </div></div><div className="mask-region-list"><strong>{t('待恢复范围', 'Recovery regions')} · {masks.length}</strong><p>{t('绿色框内会尝试取用其他截图的真实内容，不会裁掉图片。修改后点击“应用范围并预览”查看结果。', 'Green regions try clean pixels from other screenshots. They never crop the image. Apply your regions to see the result.')}</p>{!masks.length && <p>{t('没有标记范围。可框选滚动条或悬浮按钮。', 'No regions yet. Mark a scrollbar or floating control.')}</p>}{masks.map((r, i) => <div key={i} className={selected === i ? 'selected' : ''}><button disabled={disabled} onClick={() => { setSelected(i); surface.current?.querySelectorAll('.mask-box')[i]?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }}>{t('范围', 'Region')} {i + 1}<small>{r.width} × {r.height} px</small></button><button aria-label={t(`删除范围 ${i + 1}`, `Delete region ${i + 1}`)} disabled={disabled} onClick={() => { commit(masks.filter((_, j) => j !== i)); setSelected(null); }}>×</button></div>)}</div></div>
  </div>;
}
