'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check, Download, ExternalLink, ImageIcon, Loader2, Search, Trash2, X } from 'lucide-react';
import { deleteSandboxRecord, exportGallery, fetchSandboxHistory, mediaUrl, type SandboxRecord } from '@/lib/canvasApi';

interface GalleryItem {
  key: string;
  recordId: string;
  path: string;
  prompt: string;
  tool: string;
  createdAt: string;
}

const TOOL_LABEL: Record<string, string> = { t2i: '文字生成', i2i: '参考图生成' };

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toItems(records: SandboxRecord[]): GalleryItem[] {
  return records.flatMap(record => (record.output?.images || []).map((path, index) => ({
    key: `${record.id}-${index}`,
    recordId: record.id,
    path,
    prompt: String(record.input?.prompt || ''),
    tool: record.tool,
    createdAt: record.created_at,
  })));
}

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<GalleryItem | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(toItems(await fetchSandboxHistory()));
    } catch (err: any) {
      setError(err?.message || '读取作品失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter(item => item.prompt.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const allSelected = visible.length > 0 && visible.every(item => selected.has(item.key));

  const toggle = (key: string) => {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(current => {
      const next = new Set(current);
      visible.forEach(item => (allSelected ? next.delete(item.key) : next.add(item.key)));
      return next;
    });
  };

  const handleExport = async () => {
    const paths = items.filter(item => selected.has(item.key)).map(item => item.path);
    if (!paths.length) return;
    setExporting(true);
    try {
      const blob = await exportGallery(paths);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = '作品导出.zip';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      window.alert(err?.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async (item: GalleryItem) => {
    const siblings = items.filter(other => other.recordId === item.recordId).length;
    const message = siblings > 1 ? `这张图和同一次生成的另外 ${siblings - 1} 张会一起删除，删除后无法恢复。确定吗？` : '删除后无法恢复，确定删除这张作品吗？';
    if (!window.confirm(message)) return;
    try {
      await deleteSandboxRecord(item.recordId);
      setPreview(null);
      setSelected(current => {
        const next = new Set(current);
        items.filter(other => other.recordId === item.recordId).forEach(other => next.delete(other.key));
        return next;
      });
      await load();
    } catch (err: any) {
      window.alert(err?.message || '删除失败');
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold text-gray-900">图片作品</h1>
          <p className="mt-1 text-sm text-gray-500">画布和 AI 工具箱生成的图片都在这里，共 {items.length} 张。</p>
        </div>
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索提示词" className="sfa-panel-input h-10 w-56 !pl-9" />
        </label>
        <button type="button" onClick={toggleAll} disabled={!visible.length} className="sfa-panel-secondary !h-10 px-4 disabled:opacity-40">
          {allSelected ? '取消全选' : '全选'}
        </button>
        <button type="button" onClick={handleExport} disabled={!selected.size || exporting} className="sfa-panel-primary !h-10 px-4">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          批量导出（{selected.size}）
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" />加载中…</div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-24 text-sm text-gray-500">
          {error}
          <button type="button" onClick={load} className="sfa-panel-secondary px-4">重试</button>
        </div>
      ) : !visible.length ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-gray-200 py-20 text-center">
          <ImageIcon className="h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-500">{items.length ? '没有符合搜索条件的作品。' : '还没有图片作品。去画布生成第一张吧。'}</p>
          {!items.length && <Link href="/canvas" className="sfa-panel-primary px-5">去画布</Link>}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map(item => {
            const isSelected = selected.has(item.key);
            return (
              <div key={item.key} className={clsx('group overflow-hidden rounded-xl border bg-white transition-colors', isSelected ? 'border-gray-800' : 'border-gray-200 hover:border-gray-300')}>
                <div className="relative aspect-square cursor-zoom-in bg-gray-100" onClick={() => setPreview(item)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(item.path)} alt={item.prompt.slice(0, 40)} loading="lazy" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={event => { event.stopPropagation(); toggle(item.key); }}
                    className={clsx('absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-md border transition-opacity', isSelected ? 'border-gray-800 bg-gray-800 text-white' : 'border-white/60 bg-black/40 text-transparent opacity-0 group-hover:opacity-100')}
                    aria-label={isSelected ? '取消选择' : '选择'}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-1 p-2.5">
                  <p className="line-clamp-2 text-xs leading-5 text-gray-700" title={item.prompt}>{item.prompt || '（无提示词）'}</p>
                  <p className="text-[11px] text-gray-400">{TOOL_LABEL[item.tool] || item.tool} · {formatDate(item.createdAt)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}>
          <div className="flex max-h-full w-full max-w-5xl flex-col gap-3 overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 md:flex-row" onClick={event => event.stopPropagation()}>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(preview.path)} alt={preview.prompt.slice(0, 40)} className="max-h-[75vh] w-auto object-contain" />
            </div>
            <div className="flex w-full flex-col gap-3 md:w-72">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800">{TOOL_LABEL[preview.tool] || preview.tool}</span>
                <button type="button" onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-800" aria-label="关闭"><X className="h-5 w-5" /></button>
              </div>
              <p className="max-h-60 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-gray-600">{preview.prompt || '（无提示词）'}</p>
              <p className="text-xs text-gray-400">{formatDate(preview.createdAt)}</p>
              <div className="mt-auto flex flex-wrap gap-2">
                <a href={mediaUrl(preview.path)} download className="sfa-panel-primary flex-1 px-3"><Download className="h-4 w-4" />下载</a>
                <a href={mediaUrl(preview.path)} target="_blank" rel="noopener noreferrer" className="sfa-panel-secondary !h-[42px] flex-1 px-3"><ExternalLink className="h-4 w-4" />新标签打开</a>
                <button type="button" onClick={() => handleDelete(preview)} className="sfa-panel-secondary !h-[42px] w-full px-3 text-red-600"><Trash2 className="h-4 w-4" />删除</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
