'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { fetchSandboxHistory, mediaUrl } from '@/lib/canvasApi';

interface HistoryItem {
  key: string;
  path: string;
  prompt: string;
}

interface Props {
  /** 生成任务数变化时刷新 */
  refreshKey: number;
  onAddToCanvas: (path: string, label: string) => void;
  onReusePrompt: (prompt: string) => void;
}

/** 生成历史：最近的出图，点图放回画布，点文字复用提示词 */
export default function HistorySection({ refreshKey, onAddToCanvas, onReusePrompt }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const records = await fetchSandboxHistory();
      setItems(records.flatMap(record => (record.output?.images || []).map((path, index) => ({
        key: `${record.id}-${index}`,
        path,
        prompt: String(record.input?.prompt || ''),
      }))).slice(0, 24));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) load(); }, [open, refreshKey, load]);

  return (
    <section className="sfa-card-soft">
      <button type="button" onClick={() => setOpen(value => !value)} className="flex w-full items-center justify-between px-3 py-2.5 text-left" aria-expanded={open}>
        <span className="text-xs font-medium text-gray-500">生成历史{open && items.length ? `（${items.length}）` : ''}</span>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          {loading && !items.length ? (
            <p className="text-xs text-gray-400">读取中…</p>
          ) : !items.length ? (
            <p className="text-xs text-gray-400">暂无记录。</p>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-1.5">
                {items.map(item => (
                  <button key={item.key} type="button" onClick={() => onAddToCanvas(item.path, item.prompt.slice(0, 16) || '历史图片')} className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200" title={`放到画布：${item.prompt}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaUrl(item.path)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>点图片放回画布</span>
                <button type="button" onClick={load} className="flex items-center gap-1 hover:text-gray-700"><RefreshCw className="h-3 w-3" />刷新</button>
              </div>
              {items[0]?.prompt && (
                <button type="button" onClick={() => onReusePrompt(items[0].prompt)} className="sfa-btn-outline sfa-btn-sm w-full justify-center">复用最近一次的提示词</button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
