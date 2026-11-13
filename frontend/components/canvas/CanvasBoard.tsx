'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Copy, Hand, Loader2, Maximize2, Minus, MousePointer2, Plus, Redo2, ShieldAlert, Trash2, Undo2, X } from 'lucide-react';
import { mediaUrl, type CanvasCamera, type CanvasShape } from '@/lib/canvasApi';

type Tool = 'select' | 'hand';

type Drag =
  | { kind: 'pan'; startX: number; startY: number; cam: CanvasCamera }
  | { kind: 'move'; startX: number; startY: number; origin: Record<string, { x: number; y: number }>; moved: boolean }
  | { kind: 'marquee'; startX: number; startY: number; x: number; y: number; additive: boolean; base: string[] };

interface Props {
  shapes: CanvasShape[];
  onShapesChange: (updater: (shapes: CanvasShape[]) => CanvasShape[]) => void;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  camera: CanvasCamera;
  onCameraChange: (camera: CanvasCamera) => void;
  onDropFiles: (files: File[], world: { x: number; y: number }) => void;
  emptyState?: ReactNode;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const MIN_Z = 0.1;
const MAX_Z = 4;

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable));
}

export function fitCamera(shapes: CanvasShape[], width: number, height: number): CanvasCamera {
  if (!shapes.length || !width || !height) return { x: width / 2, y: height / 2, z: 1 };
  const minX = Math.min(...shapes.map(s => s.x));
  const minY = Math.min(...shapes.map(s => s.y));
  const maxX = Math.max(...shapes.map(s => s.x + s.w));
  const maxY = Math.max(...shapes.map(s => s.y + s.h + 28));
  const pad = 80;
  const z = Math.min(1, Math.max(MIN_Z, Math.min((width - pad * 2) / (maxX - minX || 1), (height - pad * 2) / (maxY - minY || 1))));
  return { z, x: width / 2 - ((minX + maxX) / 2) * z, y: height / 2 - ((minY + maxY) / 2) * z };
}

export default function CanvasBoard({ shapes, onShapesChange, selectedIds, onSelect, camera, onCameraChange, onDropFiles, emptyState, onUndo, onRedo, onDuplicate, canUndo, canRedo }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [spaceDown, setSpaceDown] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropping, setDropping] = useState(false);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    const cam = cameraRef.current;
    const sx = clientX - (rect?.left || 0);
    const sy = clientY - (rect?.top || 0);
    return { x: (sx - cam.x) / cam.z, y: (sy - cam.y) / cam.z };
  }, []);

  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    const cam = cameraRef.current;
    const sx = clientX !== undefined && rect ? clientX - rect.left : (rect?.width || 0) / 2;
    const sy = clientY !== undefined && rect ? clientY - rect.top : (rect?.height || 0) / 2;
    const z = Math.min(MAX_Z, Math.max(MIN_Z, cam.z * factor));
    const wx = (sx - cam.x) / cam.z;
    const wy = (sy - cam.y) / cam.z;
    onCameraChange({ z, x: sx - wx * z, y: sy - wy * z });
  }, [onCameraChange]);

  const fitAll = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    onCameraChange(fitCamera(shapes, rect.width, rect.height));
  }, [shapes, onCameraChange]);

  // 滚轮：触控板双指平移；按住 ⌘/Ctrl 或双指捏合缩放
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
      } else {
        const cam = cameraRef.current;
        onCameraChange({ ...cam, x: cam.x - event.deltaX, y: cam.y - event.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, onCameraChange]);

  // 快捷键
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.code === 'Space') { setSpaceDown(true); event.preventDefault(); return; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.length) {
        event.preventDefault();
        onShapesChange(list => list.filter(s => !selectedIds.includes(s.id)));
        onSelect([]);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) onRedo(); else onUndo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        onRedo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        onDuplicate();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        onSelect(shapes.map(s => s.id));
      } else if (event.key === 'Escape') {
        onSelect([]);
      } else if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'v') {
        setTool('select');
      } else if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'h') {
        setTool('hand');
      }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') setSpaceDown(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [selectedIds, shapes, onShapesChange, onSelect, onUndo, onRedo, onDuplicate]);

  const panning = tool === 'hand' || spaceDown;

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const shapeEl = (event.target as HTMLElement).closest('[data-shape-id]') as HTMLElement | null;
    if (panning || event.button === 1) {
      setDrag({ kind: 'pan', startX: event.clientX, startY: event.clientY, cam: cameraRef.current });
      return;
    }
    if (shapeEl) {
      const id = shapeEl.dataset.shapeId as string;
      let next = selectedIds;
      if (event.shiftKey || event.metaKey) {
        next = selectedIds.includes(id) ? selectedIds.filter(item => item !== id) : [...selectedIds, id];
      } else if (!selectedIds.includes(id)) {
        next = [id];
      }
      onSelect(next);
      const origin: Record<string, { x: number; y: number }> = {};
      shapes.forEach(s => { if (next.includes(s.id)) origin[s.id] = { x: s.x, y: s.y }; });
      setDrag({ kind: 'move', startX: event.clientX, startY: event.clientY, origin, moved: false });
      return;
    }
    const additive = event.shiftKey || event.metaKey;
    if (!additive) onSelect([]);
    setDrag({ kind: 'marquee', startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, additive, base: additive ? selectedIds : [] });
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      onCameraChange({ ...drag.cam, x: drag.cam.x + event.clientX - drag.startX, y: drag.cam.y + event.clientY - drag.startY });
    } else if (drag.kind === 'move') {
      const dx = (event.clientX - drag.startX) / cameraRef.current.z;
      const dy = (event.clientY - drag.startY) / cameraRef.current.z;
      if (!drag.moved && Math.hypot(dx, dy) < 2) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      onShapesChange(list => list.map(s => (drag.origin[s.id] ? { ...s, x: drag.origin[s.id].x + dx, y: drag.origin[s.id].y + dy } : s)));
    } else {
      const next = { ...drag, x: event.clientX, y: event.clientY };
      setDrag(next);
      const a = toWorld(next.startX, next.startY);
      const b = toWorld(next.x, next.y);
      const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
      const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
      const hit = shapes.filter(s => s.x < x2 && s.x + s.w > x1 && s.y < y2 && s.y + s.h > y1).map(s => s.id);
      onSelect(Array.from(new Set([...next.base, ...hit])));
    }
  };

  const handlePointerUp = () => setDrag(null);

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDropping(false);
    const files = Array.from(event.dataTransfer.files || []).filter(file => file.type.startsWith('image/'));
    if (files.length) onDropFiles(files, toWorld(event.clientX, event.clientY));
  };

  const marquee = drag?.kind === 'marquee' && rootRef.current ? (() => {
    const rect = rootRef.current!.getBoundingClientRect();
    return {
      left: Math.min(drag.startX, drag.x) - rect.left,
      top: Math.min(drag.startY, drag.y) - rect.top,
      width: Math.abs(drag.x - drag.startX),
      height: Math.abs(drag.y - drag.startY),
    };
  })() : null;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        ref={rootRef}
        className={clsx('sfa-canvas absolute inset-0 select-none touch-none', panning ? (drag?.kind === 'pan' ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default')}
        style={{
          backgroundPosition: `${camera.x}px ${camera.y}px`,
          backgroundSize: `${24 * camera.z}px ${24 * camera.z}px`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDragOver={event => { event.preventDefault(); setDropping(true); }}
        onDragLeave={() => setDropping(false)}
        onDrop={handleDrop}
        aria-label="创作画布"
        role="application"
      >
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})` }}>
          {shapes.map(shape => {
            const selected = selectedIds.includes(shape.id);
            return (
              <div key={shape.id} data-shape-id={shape.id} className="absolute" style={{ left: shape.x, top: shape.y, width: shape.w }}>
                <div
                  className={clsx('sfa-canvas-shape relative overflow-hidden', selected && 'is-selected')}
                  style={{ height: shape.h, outlineWidth: `${2 / camera.z}px` }}
                >
                  {shape.status === 'loading' ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-400">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span className="text-xs">生成中…</span>
                    </div>
                  ) : shape.status === 'error' ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-red-600">
                      <AlertCircle className="h-6 w-6" />
                      <span className="line-clamp-4 text-xs">{shape.error || '生成失败'}</span>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaUrl(shape.src)} alt={shape.label || '画布图片'} draggable={false} className="pointer-events-none h-full w-full object-contain" />
                  )}
                  {shape.check && (
                    <span
                      className={clsx(
                        'sfa-canvas-badge absolute right-2 top-2',
                        shape.check.status === 'pass' && 'text-green-600',
                        shape.check.status === 'fail' && 'text-amber-600',
                        shape.check.status === 'error' && 'text-gray-400',
                      )}
                      title={shape.check.note}
                    >
                      {shape.check.status === 'checking' && <><Loader2 className="h-3 w-3 animate-spin" />检查中</>}
                      {shape.check.status === 'pass' && <><CheckCircle2 className="h-3 w-3" />商品一致</>}
                      {shape.check.status === 'fail' && <><ShieldAlert className="h-3 w-3" />可能走样</>}
                      {shape.check.status === 'error' && <>未能检查</>}
                    </span>
                  )}
                </div>
                {selected && (
                  <button
                    type="button"
                    onPointerDown={event => event.stopPropagation()}
                    onClick={event => {
                      event.stopPropagation();
                      onShapesChange(list => list.filter(s => s.id !== shape.id));
                      onSelect(selectedIds.filter(id => id !== shape.id));
                    }}
                    className="sfa-canvas-delete absolute right-0 top-0"
                    style={{ transform: `translate(50%, -50%) scale(${1 / camera.z})` }}
                    title="删除这张图"
                    aria-label="删除这张图"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                {shape.label && (
                  <div className="mt-1.5 truncate text-gray-500" style={{ fontSize: Math.max(11, 12 / camera.z) }} title={shape.prompt || shape.label}>
                    {shape.label}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {marquee && <div className="sfa-canvas-marquee absolute" style={marquee} />}
        {dropping && <div className="pointer-events-none absolute inset-3 rounded-2xl border-2 border-dashed border-gray-300 bg-black/20" />}
      </div>

      {!shapes.length && emptyState && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
          <div className="pointer-events-auto">{emptyState}</div>
        </div>
      )}

      <div className="sfa-canvas-toolbar absolute bottom-4 left-1/2 -translate-x-1/2 max-[640px]:left-auto max-[640px]:right-4 max-[640px]:translate-x-0">
        <button type="button" className={clsx(tool === 'select' && 'is-active')} onClick={() => setTool('select')} title="选择（V）" aria-label="选择">
          <MousePointer2 className="h-4 w-4" />
        </button>
        <button type="button" className={clsx(tool === 'hand' && 'is-active')} onClick={() => setTool('hand')} title="拖动画布（H，或按住空格）" aria-label="拖动画布">
          <Hand className="h-4 w-4" />
        </button>
        <span className="sfa-canvas-toolbar-divider" />
        <button type="button" disabled={!canUndo} onClick={onUndo} title="撤销（⌘Z）" aria-label="撤销"><Undo2 className="h-4 w-4" /></button>
        <button type="button" disabled={!canRedo} onClick={onRedo} title="重做（⇧⌘Z）" aria-label="重做"><Redo2 className="h-4 w-4" /></button>
        <button type="button" disabled={!selectedIds.length} onClick={onDuplicate} title="复制选中（⌘D）" aria-label="复制选中"><Copy className="h-4 w-4" /></button>
        <button
          type="button"
          disabled={!selectedIds.length}
          onClick={() => { onShapesChange(list => list.filter(s => !selectedIds.includes(s.id))); onSelect([]); }}
          title="删除选中（Delete）"
          aria-label="删除选中"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="sfa-canvas-toolbar absolute bottom-4 left-4">
        <button type="button" onClick={() => zoomAt(1 / 1.2)} title="缩小" aria-label="缩小"><Minus className="h-4 w-4" /></button>
        <button type="button" onClick={() => onCameraChange({ ...camera, z: 1 })} className="!w-14 text-xs tabular-nums" title="恢复 100%">
          {Math.round(camera.z * 100)}%
        </button>
        <button type="button" onClick={() => zoomAt(1.2)} title="放大" aria-label="放大"><Plus className="h-4 w-4" /></button>
        <button type="button" onClick={fitAll} title="显示全部" aria-label="显示全部"><Maximize2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
