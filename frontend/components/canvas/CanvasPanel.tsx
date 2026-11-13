'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { AlertTriangle, ChevronDown, Clapperboard, Image as ImageIcon, Info, Minus, Plus, Sparkles, Star, X } from 'lucide-react';
import type { Scenario } from '@/lib/workflowApi';
import {
  deleteSavedPrompt,
  fetchSavedPrompts,
  mediaUrl,
  savePrompt,
  type BrandKit,
  type CanvasShape,
  type ImageOptions,
  type SavedPrompt,
} from '@/lib/canvasApi';
import BrandKitSection from './BrandKitSection';
import HistorySection from './HistorySection';
import VideoServiceSection from './VideoServiceSection';
import {
  BATCH_PROMPT_CHIPS,
  FOUR_SET,
  PLATFORM_PRESETS,
  SINGLE_PROMPT_CHIPS,
  STYLE_OPTIONS,
} from './canvasPresets';

export type ImageWorkflow = 'single' | 'batch' | 'sku' | 'four';

/** 一次出图任务：有 reference 走图生图，否则文生图 */
export interface GenerationJob {
  label: string;
  prompt: string;
  ratio: string;
  reference?: string;
  /** 开启保真检查时，用来对比的商品图 */
  checkAgainst?: string;
  /** 放在哪张图旁边（批量改图时贴着原图） */
  anchorId?: string;
  /** 画质 / 尺寸 / 输出格式 */
  options?: ImageOptions;
  /** 出图服务：百炼模型，或直接跑 RunningHub 工作流 */
  engine?: ImageEngine;
}

export type ImageEngine = 'bailian' | 'runninghub';
const ENGINE_KEY = 'sfa-canvas-image-engine';

export interface VideoStartRequest {
  scenario: Scenario;
  idea: string;
  episodes?: number;
  auto: boolean;
}

interface Props {
  selected: CanvasShape[];
  pricePerImage: number | null;
  busy: boolean;
  workflow: ImageWorkflow;
  onWorkflowChange: (workflow: ImageWorkflow) => void;
  onGenerate: (jobs: GenerationJob[]) => void;
  scenarios: Scenario[];
  recentSessions: Array<{ id: string; title: string; scenario?: string }>;
  onStartVideo: (request: VideoStartRequest) => void;
  videoReady: boolean;
  imageModelLabel?: string;
  /** 每次出图后加 1，用来刷新生成历史 */
  refreshKey: number;
  onAddHistoryImage: (path: string, label: string) => void;
  currentVideoModel?: string;
  onVideoModelChanged: (id: string) => void;
}

const QUALITY_OPTIONS = [
  { id: 'draft', label: '快速草稿', resolution: '720P', hint: '出图快、费用相同，适合先看构图' },
  { id: 'standard', label: '标准', resolution: '1080P', hint: '日常使用' },
  { id: 'hd', label: '高清', resolution: '2K', hint: '最清晰，适合主图和海报' },
] as const;

const FORMAT_OPTIONS = [
  { id: 'png', label: 'PNG（无损）' },
  { id: 'jpeg', label: 'JPEG（体积小）' },
  { id: 'webp', label: 'WebP（网页用）' },
];

const MAX_PIXELS = 2048 * 2048;
const MIN_PIXELS = 768 * 768;

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

const WORKFLOWS: Array<{ id: ImageWorkflow; label: string; desc: string }> = [
  { id: 'single', label: '出单张', desc: '写一句描述生成新图；也可以先在画布上选一张图作为参考。' },
  { id: 'batch', label: '批量改图', desc: '在画布上点选或框选 1–8 张图，每张按同一要求改出一张新图，原图保留。' },
  { id: 'sku', label: '多款同风格', desc: '选 1 张风格参考图，按每行一个款式，生成背景、光线、构图一致的整组图。' },
  { id: 'four', label: '一套四图', desc: '选 1 张商品图，一次生成白底图、场景图、细节图、卖点图 4 张。' },
];

function withStyle(prompt: string, styleId: string, brandStyle: string, kit: BrandKit | null) {
  const suffix = STYLE_OPTIONS.find(item => item.id === styleId)?.suffix;
  return [
    prompt.trim(),
    suffix,
    brandStyle.trim() && `统一风格：${brandStyle.trim()}`,
    kit?.style_words && `品牌风格：${kit.style_words}`,
    kit?.colors?.length && `品牌主色：${kit.colors.join('、')}`,
  ].filter(Boolean).join('，');
}

/** 品牌套件有锚点图、而任务本身没有参考图时，用锚点图作风格参考 */
function applyAnchor(job: GenerationJob, kit: BrandKit | null): GenerationJob {
  if (job.reference || !kit?.anchor_image) return job;
  return { ...job, reference: kit.anchor_image, prompt: `参考这张图的色调、光线和整体风格（不要照搬图中内容），生成：${job.prompt}` };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      {children}
      {hint && <p className="text-xs leading-5 text-gray-400">{hint}</p>}
    </section>
  );
}

export default function CanvasPanel({
  selected,
  pricePerImage,
  busy,
  workflow,
  onWorkflowChange,
  onGenerate,
  scenarios,
  recentSessions,
  onStartVideo,
  videoReady,
  imageModelLabel,
  refreshKey,
  onAddHistoryImage,
  currentVideoModel,
  onVideoModelChanged,
}: Props) {
  const [tab, setTab] = useState<'image' | 'video'>('image');
  const [singleMode, setSingleMode] = useState<'text' | 'reference'>('text');
  const [prompt, setPrompt] = useState('');
  const [batchPrompt, setBatchPrompt] = useState('');
  const [skuText, setSkuText] = useState('');
  const [sellingPoints, setSellingPoints] = useState('');
  const [brandStyle, setBrandStyle] = useState('');
  const [styleId, setStyleId] = useState('none');
  const [platformId, setPlatformId] = useState('square');
  const [count, setCount] = useState(1);
  const [fidelity, setFidelity] = useState(false);
  const [brandKitId, setBrandKitId] = useState('');
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [quality, setQuality] = useState<(typeof QUALITY_OPTIONS)[number]['id']>('hd');
  const [outputFormat, setOutputFormat] = useState('png');
  const [customSize, setCustomSize] = useState({ enabled: false, w: '1200', h: '1600' });
  const [engine, setEngineState] = useState<ImageEngine>('bailian');
  useEffect(() => {
    try { if (localStorage.getItem(ENGINE_KEY) === 'runninghub') setEngineState('runninghub'); } catch { /* 忽略 */ }
  }, []);
  const setEngine = (value: ImageEngine) => {
    setEngineState(value);
    try { localStorage.setItem(ENGINE_KEY, value); } catch { /* 忽略 */ }
  };
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);

  useEffect(() => { fetchSavedPrompts().then(setSavedPrompts); }, []);

  const images = selected.filter(shape => shape.status !== 'loading' && shape.status !== 'error' && shape.src);
  const platform = PLATFORM_PRESETS.find(item => item.id === platformId) || PLATFORM_PRESETS[0];
  const skuLines = skuText.split('\n').map(line => line.trim()).filter(Boolean);
  const pointLines = sellingPoints.split('\n').map(line => line.trim()).filter(Boolean);

  // 选了一张图时，出单张自动切到「参考图生成」
  useEffect(() => {
    if (workflow === 'single' && images.length === 1) setSingleMode('reference');
    if (workflow === 'single' && images.length === 0) setSingleMode('text');
  }, [workflow, images.length]);

  /** 当前设置能生成的任务，以及不能生成时的原因 */
  const sizeW = Number(customSize.w);
  const sizeH = Number(customSize.h);
  const sizeError = !customSize.enabled ? ''
    : !(sizeW >= 512 && sizeW <= 4096 && sizeH >= 512 && sizeH <= 4096) ? '自定义尺寸的宽和高需要在 512 到 4096 之间。'
    : sizeW * sizeH < MIN_PIXELS ? '自定义尺寸太小：宽 × 高不能低于 768 × 768 的像素总数。'
    : sizeW * sizeH > MAX_PIXELS ? '自定义尺寸太大：宽 × 高不能超过 2048 × 2048 的像素总数。'
    : '';

  const plan = useMemo((): { jobs: GenerationJob[]; reason: string } => {
    const built = buildJobs();
    if (built.reason) return built;
    if (sizeError) return { jobs: [], reason: sizeError };
    if (engine === 'runninghub') {
      if (built.jobs.some(job => !job.reference)) return { jobs: [], reason: 'RunningHub 工作流需要参考图：先在画布上选中一张图，再选「参考图生成」。' };
      return { jobs: built.jobs.map(job => ({ ...applyAnchor(job, brandKit), engine })), reason: '' };
    }
    const options: ImageOptions = {
      resolution: customSize.enabled ? `${sizeW}*${sizeH}` : QUALITY_OPTIONS.find(item => item.id === quality)!.resolution,
      output_format: outputFormat,
    };
    const customRatio = customSize.enabled ? `${sizeW / gcd(sizeW, sizeH)}:${sizeH / gcd(sizeW, sizeH)}` : '';
    return {
      // 一套四图的白底图固定 1:1，自定义尺寸只作用于其余几张
      jobs: built.jobs.map(job => {
        const fixedSquare = workflow === 'four' && job.label === '白底图';
        const jobOptions = fixedSquare && customSize.enabled ? { ...options, resolution: '2K' } : options;
        return applyAnchor({ ...job, ratio: customRatio && !fixedSquare ? customRatio : job.ratio, options: jobOptions }, brandKit);
      }),
      reason: '',
    };

  function buildJobs(): { jobs: GenerationJob[]; reason: string } {
    const ratio = platform.ratio;
    if (workflow === 'single') {
      if (!prompt.trim()) return { jobs: [], reason: '先写一句画面描述，例如「白底棚拍护肤精华液，玻璃瓶身，柔和灯光」。' };
      if (singleMode === 'reference' && images.length !== 1) return { jobs: [], reason: '参考图生成需要在画布上只选中 1 张图。' };
      const reference = singleMode === 'reference' ? images[0].src : undefined;
      const text = withStyle(prompt, styleId, brandStyle, brandKit);
      return {
        jobs: Array.from({ length: count }, (_, i) => ({ label: `${prompt.trim().slice(0, 16)}${count > 1 ? ` · ${i + 1}` : ''}`, prompt: text, ratio, reference })),
        reason: '',
      };
    }
    if (workflow === 'batch') {
      if (images.length < 1 || images.length > 8) return { jobs: [], reason: '请在画布上点选或框选 1–8 张图（按住 Shift 可多选）。' };
      if (!batchPrompt.trim()) return { jobs: [], reason: '写一句修改要求，或点上面的快捷标签。' };
      const text = withStyle(batchPrompt, styleId, brandStyle, brandKit);
      return {
        jobs: images.map(image => ({
          label: `改图 · ${(image.label || '图片').slice(0, 12)}`,
          prompt: text,
          ratio,
          reference: image.src,
          checkAgainst: fidelity ? image.src : undefined,
          anchorId: image.id,
        })),
        reason: '',
      };
    }
    if (workflow === 'sku') {
      if (images.length !== 1) return { jobs: [], reason: '请在画布上只选中 1 张风格参考图。' };
      if (!skuLines.length) return { jobs: [], reason: '每行写一个款式，例如「奶白色 350ml 保温杯」。' };
      if (skuLines.length > 8) return { jobs: [], reason: '一次最多 8 个款式。' };
      return {
        jobs: skuLines.map(sku => ({
          label: `同风格 · ${sku.slice(0, 14)}`,
          prompt: withStyle(`沿用参考图的背景、光线、构图和整体风格，把画面中的商品换成：${sku}。商品完整清晰，作为视觉中心`, styleId, brandStyle, brandKit),
          ratio,
          reference: images[0].src,
        })),
        reason: '',
      };
    }
    if (images.length !== 1) return { jobs: [], reason: '请在画布上只选中 1 张商品图。' };
    return {
      jobs: FOUR_SET.map(item => {
        const points = item.key === 'selling' && pointLines.length ? `，在文案区排版这些卖点文字：${pointLines.join('；')}` : '';
        return {
          label: item.label,
          prompt: withStyle(`${item.prompt}${points}`, styleId, brandStyle, brandKit),
          ratio: 'fixedRatio' in item ? item.fixedRatio : ratio,
          reference: images[0].src,
          checkAgainst: fidelity ? images[0].src : undefined,
          anchorId: images[0].id,
        };
      }),
      reason: '',
    };
  }
  }, [workflow, prompt, singleMode, images, styleId, brandStyle, count, batchPrompt, fidelity, skuLines, pointLines, platform.ratio, brandKit, customSize, sizeW, sizeH, sizeError, quality, outputFormat, engine]); // eslint-disable-line react-hooks/exhaustive-deps

  const jobCount = plan.jobs.length;
  const cost = pricePerImage && engine === 'bailian' ? jobCount * pricePerImage : null;
  const showFidelity = workflow === 'batch' || workflow === 'four';
  const current = WORKFLOWS.find(item => item.id === workflow)!;

  return (
    <aside className="sfa-canvas-panel flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-2 gap-1 border-b border-gray-200 p-3">
        <button type="button" onClick={() => setTab('image')} className={clsx('sfa-panel-tab', tab === 'image' && 'is-active')}>
          <ImageIcon className="h-4 w-4" />图片创作
        </button>
        <button type="button" onClick={() => setTab('video')} className={clsx('sfa-panel-tab', tab === 'video' && 'is-active')}>
          <Clapperboard className="h-4 w-4" />视频创作
        </button>
      </div>

      {tab === 'image' ? (
        <>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <div className="grid grid-cols-4 gap-1">
              {WORKFLOWS.map(item => (
                <button key={item.id} type="button" onClick={() => onWorkflowChange(item.id)} className={clsx('sfa-panel-chip', workflow === item.id && 'is-active')}>
                  {item.label}
                </button>
              ))}
            </div>
            <p className="text-xs leading-5 text-gray-400">{current.desc}</p>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span className="flex-shrink-0">图像服务</span>
                <select value={engine} onChange={event => setEngine(event.target.value as ImageEngine)} className="sfa-panel-input min-w-0 flex-1" aria-label="图像服务">
                  <option value="bailian">阿里百炼模型</option>
                  <option value="runninghub">RunningHub 工作流（直接出图）</option>
                </select>
                <Link href="/settings" className="flex-shrink-0 text-gray-500 underline hover:text-gray-800">设置</Link>
              </div>
              <p className="truncate text-xs text-gray-400">
                {engine === 'bailian'
                  ? (imageModelLabel || '读取中…')
                  : '上传选中的图 + 提示词，直接跑你在设置里填的工作流；画质、格式按工作流自己的设置，扣 RunningHub 点数。'}
              </p>
            </div>

            <BrandKitSection
              value={brandKitId}
              onChange={(id, kit) => { setBrandKitId(id); setBrandKit(kit); }}
              selectedImage={images.length === 1 ? images[0] : undefined}
            />

            {workflow !== 'single' && (
              <Field label={`已选图片（${images.length} 张）`}>
                {images.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {images.slice(0, 8).map(image => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={image.id} src={mediaUrl(image.src)} alt={image.label || ''} className="h-12 w-12 rounded-lg border border-gray-200 object-cover" />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">还没选图。在左侧画布上点一下图片即可选中，拖一个框可以选多张；也可以直接把图片拖进画布。</p>
                )}
              </Field>
            )}

            {workflow === 'single' && (
              <>
                <Field label="生成方式">
                  <div className="grid grid-cols-2 gap-1">
                    <button type="button" onClick={() => setSingleMode('text')} className={clsx('sfa-panel-chip', singleMode === 'text' && 'is-active')}>文字生成</button>
                    <button type="button" onClick={() => setSingleMode('reference')} className={clsx('sfa-panel-chip', singleMode === 'reference' && 'is-active')}>参考图生成</button>
                  </div>
                  {singleMode === 'reference' && images.length === 1 && (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={mediaUrl(images[0].src)} alt="" className="h-9 w-9 rounded-md object-cover" />
                      以选中的这张图为参考
                    </div>
                  )}
                </Field>
                <Field label="画面描述">
                  <textarea value={prompt} onChange={event => setPrompt(event.target.value)} rows={4} placeholder="描述画面主体、场景、光线、构图和关键细节" className="sfa-panel-input w-full resize-none" />
                  <div className="flex flex-wrap gap-1.5">
                    {SINGLE_PROMPT_CHIPS.map(chip => (
                      <button key={chip.label} type="button" onClick={() => setPrompt(chip.text)} className="sfa-panel-tag" title={chip.text}>{chip.label}</button>
                    ))}
                  </div>
                  <SavedPrompts items={savedPrompts} current={prompt} onPick={setPrompt} onChange={setSavedPrompts} />
                </Field>
              </>
            )}

            {workflow === 'batch' && (
              <Field label="修改要求">
                <textarea value={batchPrompt} onChange={event => setBatchPrompt(event.target.value)} rows={3} placeholder="例如：把背景换成纯白色，商品保持不变" className="sfa-panel-input w-full resize-none" />
                <div className="flex flex-wrap gap-1.5">
                  {BATCH_PROMPT_CHIPS.map(chip => (
                    <button key={chip.label} type="button" onClick={() => setBatchPrompt(chip.text)} className="sfa-panel-tag" title={chip.text}>{chip.label}</button>
                  ))}
                </div>
                <SavedPrompts items={savedPrompts} current={batchPrompt} onPick={setBatchPrompt} onChange={setSavedPrompts} />
              </Field>
            )}

            {workflow === 'sku' && (
              <Field label="款式描述（每行一个）" hint="同一张参考图贯穿整组。写清每款的颜色、包装和差异；文字生成的是示意图，真实商品细节请核对。">
                <textarea value={skuText} onChange={event => setSkuText(event.target.value)} rows={4} placeholder={'奶白色 350ml 保温杯\n雾霾蓝 350ml 保温杯\n墨黑色 500ml 保温杯'} className="sfa-panel-input w-full resize-none" />
              </Field>
            )}

            {workflow === 'four' && (
              <Field label="商品卖点（选填，每行一个）" hint="填写后卖点文字会排进卖点图，出图后请核对文字；不填则只留出文案区。白底图固定 1:1，其余 3 张用下面选的比例。细节图由 AI 推测生成，正式上架建议用实拍。">
                <textarea value={sellingPoints} onChange={event => setSellingPoints(event.target.value)} rows={3} placeholder={'12 小时保温\n一键弹盖防漏'} className="sfa-panel-input w-full resize-none" />
              </Field>
            )}

            <Field label="平台 / 用途" hint={customSize.enabled ? '已开启自定义尺寸，按下方宽高生成。' : `${platform.hint}按 ${platform.ratio} 比例生成。`}>
              <select value={platformId} onChange={event => setPlatformId(event.target.value)} className="sfa-panel-input w-full">
                {PLATFORM_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>

            <div className="grid grid-cols-1 gap-5">
              <Field label="风格">
                <select value={styleId} onChange={event => setStyleId(event.target.value)} className="sfa-panel-input w-full">
                  {STYLE_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </Field>
              {workflow === 'single' && (
                <Field label="数量">
                  <div className="grid grid-cols-4 gap-1">
                    {[1, 2, 4].map(n => (
                      <button key={n} type="button" onClick={() => setCount(n)} className={clsx('sfa-panel-chip', count === n && 'is-active')}>{n}</button>
                    ))}
                    <select
                      value={count > 4 ? String(count) : ''}
                      onChange={event => event.target.value && setCount(Number(event.target.value))}
                      className={clsx('sfa-panel-chip !px-1 text-center', count > 4 && 'is-active')}
                      aria-label="更多数量"
                    >
                      <option value="">更多</option>
                      <option value="8">8 张</option>
                      <option value="16">16 张</option>
                    </select>
                  </div>
                </Field>
              )}
            </div>

            {workflow !== 'single' && (
              <Field label="统一风格（选填）" hint="写下品牌风格词或主色，整组图都会带上，例如「奶油色调、极简、柔光」。">
                <input value={brandStyle} onChange={event => setBrandStyle(event.target.value)} placeholder="奶油色调、极简、柔光" className="sfa-panel-input w-full" />
              </Field>
            )}

            {showFidelity && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-gray-200 p-3">
                <input type="checkbox" checked={fidelity} onChange={event => setFidelity(event.target.checked)} className="mt-0.5" />
                <span className="space-y-1">
                  <span className="block text-sm text-gray-700">出图后检查商品是否走样</span>
                  <span className="block text-xs leading-5 text-gray-400">把原图和新图一起交给识图模型，判断是不是同一款、颜色形状有没有变、有没有混入别的商品。每张多 1 次识图调用，会产生少量额外费用。</span>
                </span>
              </label>
            )}

            <section className="sfa-card-soft">
              <button type="button" onClick={() => setShowAdvanced(value => !value)} className="flex w-full items-center justify-between px-3 py-2.5 text-left" aria-expanded={showAdvanced}>
                <span className="text-xs font-medium text-gray-500">高级设置 <span className="font-normal text-gray-400">· {QUALITY_OPTIONS.find(item => item.id === quality)!.label} · {outputFormat.toUpperCase()}{customSize.enabled ? ` · ${customSize.w}×${customSize.h}` : ''}</span></span>
                <ChevronDown className={clsx('h-4 w-4 text-gray-400 transition-transform', showAdvanced && 'rotate-180')} />
              </button>
              {showAdvanced && (
                <div className="space-y-4 px-3 pb-3">
                  <Field label="画质" hint={QUALITY_OPTIONS.find(item => item.id === quality)!.hint}>
                    <div className="grid grid-cols-3 gap-1">
                      {QUALITY_OPTIONS.map(item => (
                        <button key={item.id} type="button" disabled={customSize.enabled} onClick={() => setQuality(item.id)} className={clsx('sfa-panel-chip disabled:opacity-40', quality === item.id && 'is-active')}>{item.label}</button>
                      ))}
                    </div>
                  </Field>
                  <Field label="输出格式">
                    <select value={outputFormat} onChange={event => setOutputFormat(event.target.value)} className="sfa-panel-input w-full">
                      {FORMAT_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </Field>
                  <Field label="自定义尺寸（选填）" hint="开启后按宽 × 高生成，覆盖上面的平台比例和画质。宽高在 512–4096 之间，总像素在 768 × 768 到 2048 × 2048 之间。">
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input type="checkbox" checked={customSize.enabled} onChange={event => setCustomSize(size => ({ ...size, enabled: event.target.checked }))} />
                      使用自定义尺寸
                    </label>
                    {customSize.enabled && (
                      <div className="flex items-center gap-2">
                        <input type="number" min={512} max={4096} value={customSize.w} onChange={event => setCustomSize(size => ({ ...size, w: event.target.value }))} className="sfa-panel-input w-full" aria-label="宽度" />
                        <span className="text-gray-400">×</span>
                        <input type="number" min={512} max={4096} value={customSize.h} onChange={event => setCustomSize(size => ({ ...size, h: event.target.value }))} className="sfa-panel-input w-full" aria-label="高度" />
                      </div>
                    )}
                  </Field>
                </div>
              )}
            </section>

            <HistorySection
              refreshKey={refreshKey}
              onAddToCanvas={onAddHistoryImage}
              onReusePrompt={text => {
                if (workflow === 'batch') setBatchPrompt(text);
                else { onWorkflowChange('single'); setPrompt(text); }
              }}
            />
          </div>

          <div className="space-y-2 border-t border-gray-200 p-4">
            {plan.reason && (
              <div className="sfa-panel-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>{plan.reason}</span>
              </div>
            )}
            <button type="button" disabled={!jobCount || busy} onClick={() => onGenerate(plan.jobs)} className="sfa-panel-primary w-full">
              <Sparkles className="h-4 w-4" />
              {busy ? '正在生成…' : `生成 ${jobCount} 张到画布`}
              {cost !== null && jobCount > 0 && !busy && <span className="opacity-60">· 约 ¥{cost.toFixed(1)}</span>}
              {engine === 'runninghub' && jobCount > 0 && !busy && <span className="opacity-60">· RunningHub</span>}
            </button>
          </div>
        </>
      ) : (
        <VideoTab scenarios={scenarios} recentSessions={recentSessions} onStart={onStartVideo} ready={videoReady} currentVideoModel={currentVideoModel} onVideoModelChanged={onVideoModelChanged} />
      )}
    </aside>
  );
}

function VideoTab({
  scenarios,
  recentSessions,
  onStart,
  ready,
  currentVideoModel,
  onVideoModelChanged,
}: {
  scenarios: Scenario[];
  recentSessions: Props['recentSessions'];
  onStart: Props['onStartVideo'];
  ready: boolean;
  currentVideoModel?: string;
  onVideoModelChanged: (id: string) => void;
}) {
  const [scenarioId, setScenarioId] = useState('');
  const [idea, setIdea] = useState('');
  const [episodes, setEpisodes] = useState(1);
  const scenario = scenarios.find(item => item.id === scenarioId) || scenarios[0];

  useEffect(() => {
    if (!scenarioId && scenarios.length) setScenarioId(scenarios[0].id);
  }, [scenarios, scenarioId]);

  useEffect(() => {
    setEpisodes(Number(scenario?.defaults?.episodes) || 1);
  }, [scenario?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const episodesLabel = scenario?.ui?.episodes_label || '集数';
  const reason = !scenario ? '场景加载中…' : !ready ? '模型配置读取中…' : !idea.trim() ? '先写下你的想法。' : '';

  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <p className="text-xs leading-5 text-gray-400">选一个场景，写下想法。开始后进入分步工作台：剧本、角色、分镜、画面、视频逐步生成，每一步都可以确认、修改或重做。</p>
        <VideoServiceSection currentModel={currentVideoModel} onChanged={onVideoModelChanged} />
        <Field label="场景">
          <div className="grid grid-cols-2 gap-1.5">
            {scenarios.map(item => (
              <button key={item.id} type="button" onClick={() => setScenarioId(item.id)} className={clsx('sfa-panel-card', scenario?.id === item.id && 'is-active')}>
                <span className="block text-sm">{item.name}</span>
                <span className="mt-0.5 block text-xs text-gray-400 line-clamp-2">{item.tagline}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="你的想法">
          <textarea value={idea} onChange={event => setIdea(event.target.value)} rows={5} placeholder={scenario?.ui?.placeholder || '写下你的想法'} className="sfa-panel-input w-full resize-none" />
          {!!scenario?.ui?.examples?.length && (
            <div className="flex flex-wrap gap-1.5">
              {scenario.ui.examples.slice(0, 4).map(example => (
                <button key={example.title} type="button" onClick={() => setIdea(example.idea)} className="sfa-panel-tag" title={example.idea}>{example.title}</button>
              ))}
            </div>
          )}
        </Field>
        {scenario?.defaults?.episodes !== undefined && (
          <Field label={episodesLabel} hint="先做 1 个看看效果，满意了再加。视频按秒计费，是整个流程里最贵的一步。">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setEpisodes(n => Math.max(1, n - 1))} className="sfa-panel-chip !w-9" aria-label="减少"><Minus className="h-3.5 w-3.5" /></button>
              <span className="w-8 text-center text-sm tabular-nums">{episodes}</span>
              <button type="button" onClick={() => setEpisodes(n => Math.min(10, n + 1))} className="sfa-panel-chip !w-9" aria-label="增加"><Plus className="h-3.5 w-3.5" /></button>
            </div>
          </Field>
        )}
        {recentSessions.length > 0 && (
          <Field label="最近的视频项目">
            <div className="space-y-1">
              {recentSessions.slice(0, 3).map(item => (
                <Link key={item.id} href={`/?session=${encodeURIComponent(item.id)}`} className="block truncate rounded-lg px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                  {item.title}
                </Link>
              ))}
              <Link href="/projects?tab=projects" className="block px-2 py-1 text-xs text-gray-400 hover:text-gray-700">查看全部 →</Link>
            </div>
          </Field>
        )}
      </div>
      <div className="space-y-2 border-t border-gray-200 p-4">
        {reason && (
          <div className="sfa-panel-warning">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>{reason}</span>
          </div>
        )}
        <button type="button" disabled={!!reason} onClick={() => scenario && onStart({ scenario, idea: idea.trim(), episodes: scenario.defaults?.episodes !== undefined ? episodes : undefined, auto: false })} className="sfa-panel-primary w-full">
          逐步创作（推荐）
        </button>
        <button type="button" disabled={!!reason} onClick={() => scenario && onStart({ scenario, idea: idea.trim(), episodes: scenario.defaults?.episodes !== undefined ? episodes : undefined, auto: true })} className="sfa-panel-secondary w-full">
          全自动生成（不逐步确认）
        </button>
      </div>
    </>
  );
}

/** 常用提示词：收藏当前描述，点一下填回 */
function SavedPrompts({ items, current, onPick, onChange }: { items: SavedPrompt[]; current: string; onPick: (text: string) => void; onChange: (items: SavedPrompt[]) => void }) {
  const text = current.trim();
  const saved = items.some(item => item.text === text);
  const [error, setError] = useState('');
  const add = async () => {
    setError('');
    try {
      const record = await savePrompt(text);
      onChange([record, ...items.filter(item => item.id !== record.id)]);
    } catch (err: any) {
      setError(err?.message || '收藏失败');
    }
  };
  const remove = async (id: string) => {
    await deleteSavedPrompt(id);
    onChange(items.filter(item => item.id !== id));
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">常用提示词 {items.length ? `· ${items.length} 条` : ''}</span>
        <button type="button" disabled={!text || saved} onClick={add} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40">
          <Star className="h-3 w-3" />{saved ? '已收藏' : '收藏当前描述'}
        </button>
      </div>
      {items.length > 0 && (
        <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
          {items.map(item => (
            <span key={item.id} className="sfa-panel-tag flex max-w-full items-center gap-1 !pr-1.5">
              <button type="button" onClick={() => onPick(item.text)} className="min-w-0 truncate" title={item.text}>{item.text.slice(0, 14)}</button>
              <button type="button" onClick={() => remove(item.id)} className="text-gray-400 hover:text-gray-800" aria-label="删除这条常用提示词"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
