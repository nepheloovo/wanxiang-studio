'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { deleteBrandKit, fetchBrandKits, mediaUrl, saveBrandKit, type BrandKit, type BrandKitInput, type CanvasShape } from '@/lib/canvasApi';

interface Props {
  value: string;
  onChange: (id: string, kit: BrandKit | null) => void;
  /** 画布上当前选中的图，用作风格锚点图 */
  selectedImage?: CanvasShape;
}

const EMPTY: BrandKitInput = { name: '', style_words: '', colors: ['#f5efe2'], anchor_image: '' };

/** 品牌套件：风格词 + 主色 + 风格锚点图，选用后整批出图都带上 */
export default function BrandKitSection({ value, onChange, selectedImage }: Props) {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [editing, setEditing] = useState<{ id?: string; draft: BrandKitInput } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = async (selectId?: string) => {
    const list = await fetchBrandKits();
    setKits(list);
    const id = selectId ?? value;
    onChange(id, list.find(kit => kit.id === id) || null);
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const current = kits.find(kit => kit.id === value);

  const save = async () => {
    if (!editing) return;
    if (!editing.draft.name.trim()) { setError('给套件起个名字'); return; }
    setSaving(true);
    setError('');
    try {
      const saved = await saveBrandKit(editing.draft, editing.id);
      setEditing(null);
      await reload(saved.id);
    } catch (err: any) {
      setError(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!current || !window.confirm(`删除品牌套件「${current.name}」？`)) return;
    await deleteBrandKit(current.id).catch(() => {});
    await reload('');
  };

  const setDraft = (patch: Partial<BrandKitInput>) => setEditing(state => (state ? { ...state, draft: { ...state.draft, ...patch } } : state));

  return (
    <section className="sfa-card-soft space-y-2.5 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">品牌套件</span>
        <button type="button" onClick={() => { setError(''); setEditing({ draft: { ...EMPTY } }); }} className="sfa-btn-outline sfa-btn-sm">
          <Plus className="h-3.5 w-3.5" />新建
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <select value={value} onChange={event => onChange(event.target.value, kits.find(kit => kit.id === event.target.value) || null)} className="sfa-panel-input min-w-0 flex-1">
          <option value="">不使用品牌套件</option>
          {kits.map(kit => <option key={kit.id} value={kit.id}>{kit.name}</option>)}
        </select>
        {current && (
          <>
            <button type="button" onClick={() => { setError(''); setEditing({ id: current.id, draft: { name: current.name, style_words: current.style_words, colors: current.colors.length ? current.colors : ['#f5efe2'], anchor_image: current.anchor_image } }); }} className="sfa-btn-outline sfa-btn-icon" title="编辑" aria-label="编辑品牌套件"><Pencil className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={remove} className="sfa-btn-outline sfa-btn-icon" title="删除" aria-label="删除品牌套件"><Trash2 className="h-3.5 w-3.5" /></button>
          </>
        )}
      </div>
      {current ? (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          {current.anchor_image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(current.anchor_image)} alt="" className="h-8 w-8 rounded-md object-cover" />
          )}
          <span className="flex gap-1">{current.colors.map(color => <span key={color} className="h-3.5 w-3.5 rounded-full border border-gray-300" style={{ background: color }} />)}</span>
          <span className="min-w-0 truncate">{current.style_words || '未填风格词'}</span>
        </div>
      ) : (
        <p className="text-xs leading-5 text-gray-400">把品牌风格词、主色和一张风格锚点图存成套件，选用后整批出图自动保持一致。</p>
      )}

      {editing && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={() => setEditing(null)}>
          <div className="sfa-card w-full max-w-md space-y-4 p-5" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-medium text-gray-800">{editing.id ? '编辑品牌套件' : '新建品牌套件'}</h3>
              <button type="button" onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-800" aria-label="关闭"><X className="h-5 w-5" /></button>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs text-gray-500">名称</span>
              <input value={editing.draft.name} onChange={event => setDraft({ name: event.target.value })} placeholder="例如：奶油风护肤" maxLength={40} className="sfa-panel-input w-full" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-gray-500">风格词</span>
              <textarea value={editing.draft.style_words} onChange={event => setDraft({ style_words: event.target.value })} rows={2} placeholder="例如：奶油色调、极简构图、柔和自然光、干净留白" maxLength={300} className="sfa-panel-input w-full resize-none" />
            </label>
            <div className="space-y-1.5">
              <span className="text-xs text-gray-500">主色（最多 5 个）</span>
              <div className="flex flex-wrap items-center gap-2">
                {editing.draft.colors.map((color, index) => (
                  <span key={index} className="flex items-center gap-1">
                    <input type="color" value={color} onChange={event => setDraft({ colors: editing.draft.colors.map((c, i) => (i === index ? event.target.value : c)) })} className="h-8 w-10 cursor-pointer rounded border border-gray-200 bg-transparent" aria-label={`主色 ${index + 1}`} />
                    <button type="button" onClick={() => setDraft({ colors: editing.draft.colors.filter((_, i) => i !== index) })} className="text-gray-400 hover:text-gray-800" aria-label="移除颜色"><X className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
                {editing.draft.colors.length < 5 && (
                  <button type="button" onClick={() => setDraft({ colors: [...editing.draft.colors, '#c9b79c'] })} className="sfa-btn-outline sfa-btn-sm"><Plus className="h-3.5 w-3.5" />加颜色</button>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-xs text-gray-500">风格锚点图（选填）</span>
              <div className="flex items-center gap-2">
                {editing.draft.anchor_image ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaUrl(editing.draft.anchor_image)} alt="" className="h-14 w-14 rounded-lg object-cover" />
                    <button type="button" onClick={() => setDraft({ anchor_image: '' })} className="sfa-btn-outline sfa-btn-sm">移除</button>
                  </>
                ) : (
                  <button type="button" disabled={!selectedImage?.src} onClick={() => selectedImage?.src && setDraft({ anchor_image: selectedImage.src })} className="sfa-btn-outline sfa-btn-sm">
                    用画布上选中的图
                  </button>
                )}
              </div>
              <p className="text-xs leading-5 text-gray-400">
                {selectedImage?.src ? '会用它的色调、光线和整体风格作参考。' : '先在画布上选中一张图，才能设为锚点图。'}没有参考图的出图会以锚点图为参考；已经有参考图时只用风格词和主色。
              </p>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="sfa-btn-outline">取消</button>
              <button type="button" onClick={save} disabled={saving} className="sfa-btn-primary">{saving ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
