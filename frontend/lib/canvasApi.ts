/* 画布、出图工作流和作品图库用到的接口 */

import { brand } from '@/config/brand';

/** 画布「视频创作」把启动参数放在 sessionStorage 里交给首页 */
export const PENDING_START_KEY = `${brand.storagePrefix}.pending-start`;

export interface CanvasShape {
  id: string;
  /** 图片路径（result/... 或 http URL）；生成中时为空 */
  src?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  prompt?: string;
  status?: 'loading' | 'done' | 'error';
  error?: string;
  /** 商品保真检查结果 */
  check?: { status: 'checking' | 'pass' | 'fail' | 'error'; note?: string };
}

export interface CanvasCamera {
  x: number;
  y: number;
  z: number;
}

export interface CanvasBoard {
  shapes: CanvasShape[];
  camera: CanvasCamera | null;
}

export interface SandboxRecord {
  id: string;
  tool: string;
  model: string;
  input: Record<string, any>;
  output: { images?: string[]; response?: string; video_path?: string };
  created_at: string;
}

export function mediaUrl(path?: string): string {
  if (!path) return '';
  if (/^(https?:|blob:|data:)/.test(path) || path.startsWith('/code/')) return path;
  return `/code/${path.replace(/^\/+/, '')}`;
}

async function readError(resp: Response, fallback: string): Promise<string> {
  try {
    const data = await resp.json();
    return data?.detail || data?.error || fallback;
  } catch {
    return fallback;
  }
}

export async function uploadCanvasImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch('/api/canvas/upload', { method: 'POST', body: form });
  if (!resp.ok) throw new Error(await readError(resp, '图片上传失败'));
  const data = await resp.json();
  return data.path as string;
}

export async function loadCanvasBoard(): Promise<CanvasBoard> {
  const resp = await fetch('/api/canvas/board');
  if (!resp.ok) return { shapes: [], camera: null };
  const data = await resp.json();
  return { shapes: Array.isArray(data?.shapes) ? data.shapes : [], camera: data?.camera || null };
}

export async function saveCanvasBoard(board: CanvasBoard): Promise<void> {
  await fetch('/api/canvas/board', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(board),
  });
}

async function postSandbox(path: string, body: Record<string, any>): Promise<any> {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await readError(resp, '生成失败'));
  const data = await resp.json();
  if (!data?.success) throw new Error(data?.error || '生成失败');
  return data;
}

export interface ImageOptions {
  /** 720P / 1080P / 2K，或自定义「宽*高」 */
  resolution?: string;
  /** png / jpeg / webp */
  output_format?: string;
}

/** 文生图，返回图片路径 */
export async function textToImage(params: { model: string; prompt: string; ratio: string } & ImageOptions): Promise<string[]> {
  const data = await postSandbox('/api/sandbox/t2i', { ...params, style: 'none' });
  return data.result || [];
}

/** 参考图生图，返回图片路径 */
export async function imageToImage(params: { model: string; prompt: string; image: string; ratio: string } & ImageOptions): Promise<string[]> {
  const data = await postSandbox('/api/sandbox/i2i', params);
  return data.result || [];
}

/** 直接跑 RunningHub 工作流出图（参考图 + 提示词） */
export async function runningHubImage(params: { prompt: string; image?: string; ratio?: string }): Promise<string[]> {
  const resp = await fetch('/api/canvas/runninghub/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw new Error(await readError(resp, 'RunningHub 出图失败'));
  const data = await resp.json();
  return data.result || [];
}

/** 让识图模型对比参考图和新图，判断商品是否保真 */
export async function checkFidelity(params: { model: string; reference: string; generated: string }): Promise<{ pass: boolean; note: string }> {
  const prompt = [
    '第一张是商品参考图，第二张是 AI 生成的新图。请逐条判断：',
    '1. 新图里的商品是否与参考图是同一款商品；',
    '2. 商品的颜色、形状、图案、文字是否发生明显变化；',
    '3. 是否混入了参考图里没有的其它商品。',
    '只输出 JSON：{"pass": true 或 false, "note": "一句话说明问题，没有问题写「商品一致」"}',
  ].join('\n');
  const data = await postSandbox('/api/sandbox/vlm', { model: params.model, prompt, images: [params.reference, params.generated] });
  const text = String(data.result || '');
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      return { pass: Boolean(parsed.pass), note: String(parsed.note || '') };
    } catch { /* fall through */ }
  }
  return { pass: !/不一致|变化|混入|不是同一/.test(text), note: text.slice(0, 60) };
}

export async function fetchSandboxHistory(): Promise<SandboxRecord[]> {
  const resp = await fetch('/api/sandbox/history');
  if (!resp.ok) throw new Error(await readError(resp, '读取作品失败'));
  const data = await resp.json();
  return Array.isArray(data?.records) ? data.records : Array.isArray(data) ? data : [];
}

export async function deleteSandboxRecord(id: string): Promise<void> {
  const resp = await fetch(`/api/sandbox/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(await readError(resp, '删除失败'));
}

export async function exportGallery(paths: string[]): Promise<Blob> {
  const resp = await fetch('/api/gallery/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  if (!resp.ok) throw new Error(await readError(resp, '导出失败'));
  return resp.blob();
}

export interface AppConfigModels {
  llm: string;
  vlm: string;
  image_t2i: string;
  image_it2i: string;
  video_first_frame: string;
  video_start_end: string;
  video_reference: string;
  video?: string;
}

export async function fetchAppConfig(): Promise<{ models: AppConfigModels; generation: Record<string, any> }> {
  const resp = await fetch('/api/config');
  if (!resp.ok) throw new Error('读取配置失败');
  const data = await resp.json();
  const config = data?.config || {};
  return { models: config.models || {}, generation: config.generation || {} };
}

/** 读取某个图片模型的单价（元 / 张），未登记时返回 null */
export async function fetchImagePrice(modelId: string): Promise<number | null> {
  try {
    const resp = await fetch('/api/models?model_type=i2i');
    const data = await resp.json();
    const found = (data?.models || []).find((m: any) => m.id === modelId);
    const price = Number(found?.price_per_image);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/* ── 品牌套件 ── */
export interface BrandKit {
  id: string;
  name: string;
  style_words: string;
  colors: string[];
  anchor_image: string;
}

export type BrandKitInput = Omit<BrandKit, 'id'>;

export async function fetchBrandKits(): Promise<BrandKit[]> {
  const resp = await fetch('/api/canvas/brand-kits');
  if (!resp.ok) return [];
  const data = await resp.json();
  return Array.isArray(data?.kits) ? data.kits : [];
}

export async function saveBrandKit(kit: BrandKitInput, id?: string): Promise<BrandKit> {
  const resp = await fetch(id ? `/api/canvas/brand-kits/${encodeURIComponent(id)}` : '/api/canvas/brand-kits', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(kit),
  });
  if (!resp.ok) throw new Error(await readError(resp, '保存品牌套件失败'));
  return resp.json();
}

export async function deleteBrandKit(id: string): Promise<void> {
  const resp = await fetch(`/api/canvas/brand-kits/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(await readError(resp, '删除失败'));
}

/* ── 常用提示词 ── */
export interface SavedPrompt {
  id: string;
  text: string;
}

export async function fetchSavedPrompts(): Promise<SavedPrompt[]> {
  const resp = await fetch('/api/canvas/prompts');
  if (!resp.ok) return [];
  const data = await resp.json();
  return Array.isArray(data?.prompts) ? data.prompts : [];
}

export async function savePrompt(text: string): Promise<SavedPrompt> {
  const resp = await fetch('/api/canvas/prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!resp.ok) throw new Error(await readError(resp, '收藏失败'));
  return resp.json();
}

export async function deleteSavedPrompt(id: string): Promise<void> {
  await fetch(`/api/canvas/prompts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ── 视频服务 ── */
export interface VideoModelOption {
  id: string;
  label: string;
  provider: string;
  price_per_second?: number | null;
}

export async function fetchFirstFrameVideoModels(): Promise<VideoModelOption[]> {
  const resp = await fetch('/api/models?model_type=video');
  if (!resp.ok) return [];
  const data = await resp.json();
  return (data?.models || [])
    .filter((m: any) => (m.adapter_ability_types || []).includes('first_frame_i2v'))
    .map((m: any) => ({ id: m.id, label: m.label || m.id, provider: m.provider, price_per_second: m.price_per_second }));
}

/** 切换默认的首帧生视频模型（设置页里同一个配置项） */
export async function setDefaultVideoModel(modelId: string): Promise<void> {
  const resp = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: { models: { video_first_frame: modelId, video: modelId } } }),
  });
  if (!resp.ok) throw new Error(await readError(resp, '保存失败'));
}

export async function checkRunningHubAccount(): Promise<string> {
  const resp = await fetch('/api/providers/runninghub/account', { method: 'POST' });
  if (!resp.ok) throw new Error(await readError(resp, '核查失败'));
  const data = await resp.json();
  const account = data?.account || {};
  const balance = account.remainCoins ?? account.remainMoney ?? account.balance;
  return balance !== undefined ? `连接正常，剩余：${balance}` : '连接正常';
}
