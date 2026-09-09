import { useRef } from 'react';
import type { Trim } from './output';

export default function EdgeCropper({ url, width, height, trim, onChange, firstHeight, lastHeight, disabled, zh }: {
  url: string; width: number; height: number; trim: Trim; onChange: (trim: Trim) => void; firstHeight: number; lastHeight: number; disabled: boolean; zh: boolean;
}) {
  const t = (cn: string, en: string) => zh ? cn : en;
  return <section className="edge-cropper" aria-label={t('裁剪长图首尾', 'Trim image edges')}>
    <div className="crop-heading"><div><h3>{t('裁剪顶部 / 底部', 'Trim top / bottom')}</h3><p>{t('拖动分界线或滑条。红色区域将从最终长图中删除，中间内容和图片宽度保持不变。', 'Drag a boundary or slider. Red areas are removed from the final image; middle content and width stay intact.')}</p></div><button disabled={disabled || (!trim.top && !trim.bottom)} onClick={() => onChange({ top: 0, bottom: 0 })}>{t('恢复完整首尾', 'Restore full edges')}</button></div>
    <div className="crop-edges">{(['top', 'bottom'] as const).map(edge => <Edge key={edge} edge={edge} url={url} width={width} height={height} value={trim[edge]} max={Math.min(edge === 'top' ? firstHeight - 1 : lastHeight - 1, height - trim[edge === 'top' ? 'bottom' : 'top'] - 1)} disabled={disabled} zh={zh} onChange={value => onChange({ ...trim, [edge]: value })} />)}</div>
    <p className="crop-size" aria-live="polite">{t('裁剪后', 'After trimming')} <strong>{width} × {height - trim.top - trim.bottom}</strong> · {t('顶部删除', 'Top removed')} {trim.top}px · {t('底部删除', 'Bottom removed')} {trim.bottom}px</p>
  </section>;
}

function Edge({ edge, url, width, height, value, max, disabled, zh, onChange }: {
  edge: 'top' | 'bottom'; url: string; width: number; height: number; value: number; max: number; disabled: boolean; zh: boolean; onChange: (value: number) => void;
}) {
  const view = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; value: number; scale: number; pointer: number } | null>(null);
  const title = zh ? edge === 'top' ? '顶部' : '底部' : edge === 'top' ? 'Top' : 'Bottom';
  // Widen context as the cut moves, but freeze the gesture scale while dragging.
  const context = Math.min(height, Math.max(Math.min(max + 1, Math.round(width * .6)), value + Math.round(width * .12)));
  const removed = value / context * 100;
  const setValue = (n: number) => onChange(Math.max(0, Math.min(max, Math.round(n))));
  const move = (e: React.PointerEvent) => {
    const g = drag.current; if (!g || g.pointer !== e.pointerId) return;
    setValue(g.value + (e.clientY - g.startY) * g.scale * (edge === 'top' ? 1 : -1));
  };
  return <div className="crop-edge"><div className="edge-title"><strong>{title}</strong><span>{zh ? '删除' : 'Remove'} {value}px</span></div>
    <div className="crop-edge-context" ref={view} style={{ aspectRatio: `${width} / ${context}` }}>
      <div className="crop-edge-image"><img src={url} alt={zh ? `长图${title}局部` : `${title} of stitched image`} draggable={false} style={{ height: `${height / context * 100}%`, ...(edge === 'top' ? { top: 0 } : { bottom: 0 }) }} /></div>
      <div className={`crop-removed ${edge}`} style={{ height: `${removed}%` }}><span>{value > 0 && (zh ? '将删除' : 'Remove')}</span></div>
      <button className="crop-boundary" role="slider" aria-label={zh ? `${title}裁剪边界` : `${title} crop boundary`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-orientation="vertical" aria-valuetext={zh ? `删除 ${value} 像素` : `Remove ${value} pixels`} disabled={disabled} style={{ top: `${edge === 'top' ? removed : 100 - removed}%` }} onPointerDown={e => { if (e.button !== 0 || disabled) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { startY: e.clientY, value, scale: context / view.current!.getBoundingClientRect().height, pointer: e.pointerId }; }} onPointerMove={move} onPointerUp={e => { move(e); drag.current = null; }} onPointerCancel={() => { if (drag.current) onChange(drag.current.value); drag.current = null; }} onKeyDown={e => { const step = e.shiftKey ? 10 : 1; if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setValue(value + (e.key === 'ArrowDown' ? 1 : -1) * step * (edge === 'top' ? 1 : -1)); } else if (e.key === 'Home') { e.preventDefault(); setValue(0); } else if (e.key === 'End') { e.preventDefault(); setValue(max); } }}><span>↕ {zh ? '拖动裁剪' : 'Drag to trim'}</span></button>
    </div><div className="edge-range"><label className="sr-only" htmlFor={`trim-${edge}`}>{zh ? `${title}删除高度` : `${title} trim amount`}</label><input id={`trim-${edge}`} type="range" min="0" max={max} value={value} disabled={disabled} onChange={e => setValue(+e.target.value)} /><button disabled={disabled || value === 0} onClick={() => setValue(0)}>{zh ? '重置' : 'Reset'}</button></div>
  </div>;
}
