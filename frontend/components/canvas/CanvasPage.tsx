'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus } from 'lucide-react';
import { fetchScenarios, fetchSessions, type Scenario } from '@/lib/workflowApi';
import {
  checkFidelity,
  fetchAppConfig,
  fetchImagePrice,
  imageToImage,
  runningHubImage,
  loadCanvasBoard,
  mediaUrl,
  PENDING_START_KEY,
  saveCanvasBoard,
  textToImage,
  uploadCanvasImage,
  type AppConfigModels,
  type CanvasCamera,
  type CanvasShape,
} from '@/lib/canvasApi';
import CanvasBoard, { fitCamera } from './CanvasBoard';
import CanvasPanel, { type GenerationJob, type ImageWorkflow, type VideoStartRequest } from './CanvasPanel';
import { sizeForRatio } from './canvasPresets';

const MAX_PARALLEL = 3;
const GAP = 40;

const newId = () => Math.random().toString(36).slice(2, 10);

/** 新图放在哪：批量改图贴在原图右侧；其余排在所有内容右边一列 */
function placeJobs(shapes: CanvasShape[], jobs: GenerationJob[], viewportCenter: { x: number; y: number }): CanvasShape[] {
  const anchorCounts: Record<string, number> = {};
  const loose: GenerationJob[] = [];
  const placed: CanvasShape[] = [];
  const rightEdge = shapes.length ? Math.max(...shapes.map(s => s.x + s.w)) + GAP * 2 : viewportCenter.x - 160;
  const topEdge = shapes.length ? Math.min(...shapes.map(s => s.y)) : viewportCenter.y - 160;
  // 同一张图带出多张新图（一套四图）时排成一行，放在原图右边
  jobs.forEach(job => {
    const anchor = job.anchorId ? shapes.find(s => s.id === job.anchorId) : undefined;
    if (!anchor) { loose.push(job); return; }
    const i = anchorCounts[anchor.id] = (anchorCounts[anchor.id] ?? -1) + 1;
    const size = sizeForRatio(job.ratio, anchor.h > 0 ? Math.max(anchor.w, anchor.h) : 320);
    placed.push({
      id: newId(), x: anchor.x + (anchor.w + GAP) * (i + 1), y: anchor.y, ...size,
      label: job.label, prompt: job.prompt, status: 'loading',
    });
  });
  // 避免贴图位置压住已有图片：整体移到最右侧
  const overlaps = placed.some(p => shapes.some(s => p.x < s.x + s.w && p.x + p.w > s.x && p.y < s.y + s.h && p.y + p.h > s.y));
  if (overlaps) {
    let x = rightEdge;
    placed.forEach(p => { p.x = x; p.y = topEdge; x += p.w + GAP; });
  }
  let x = placed.length ? Math.max(rightEdge, ...placed.map(p => p.x + p.w + GAP)) : rightEdge;
  loose.forEach(job => {
    const size = sizeForRatio(job.ratio);
    placed.push({ id: newId(), x, y: topEdge, ...size, label: job.label, prompt: job.prompt, status: 'loading' });
    x += size.w + GAP;
  });
  return placed;
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export default function CanvasPage() {
  const router = useRouter();
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const [shapes, setShapes] = useState<CanvasShape[]>([]);
  const [camera, setCamera] = useState<CanvasCamera>({ x: 0, y: 0, z: 1 });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [workflow, setWorkflow] = useState<ImageWorkflow>('single');
  const [models, setModels] = useState<AppConfigModels | null>(null);
  const [generation, setGeneration] = useState<Record<string, any>>({});
  const [price, setPrice] = useState<number | null>(null);
  const [running, setRunning] = useState(0);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [recent, setRecent] = useState<Array<{ id: string; title: string }>>([]);
  const [notice, setNotice] = useState('');
  const [generatedCount, setGeneratedCount] = useState(0);
  const [videoModel, setVideoModel] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 撤销 / 重做：形状稳定 400ms 后记一步 ──
  const pastRef = useRef<CanvasShape[][]>([]);
  const futureRef = useRef<CanvasShape[][]>([]);
  const stableRef = useRef<CanvasShape[] | null>(null);
  const skipRecordRef = useRef(false);
  const [, forceHistory] = useState(0);
  const geometry = (list: CanvasShape[]) => JSON.stringify(list.map(({ id, x, y, w, h, src }) => [id, x, y, w, h, src]));

  useEffect(() => {
    if (!loaded) return;
    if (stableRef.current === null) { stableRef.current = shapes; return; }
    const timer = window.setTimeout(() => {
      if (skipRecordRef.current) { skipRecordRef.current = false; stableRef.current = shapes; return; }
      if (geometry(stableRef.current || []) === geometry(shapes)) { stableRef.current = shapes; return; }
      pastRef.current = [...pastRef.current.slice(-49), stableRef.current || []];
      futureRef.current = [];
      stableRef.current = shapes;
      forceHistory(n => n + 1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [shapes, loaded]);

  /** 恢复快照时，已经生成好的图不退回「生成中」 */
  const restore = (snapshot: CanvasShape[], current: CanvasShape[]) => snapshot.map(shape => {
    const now = current.find(item => item.id === shape.id);
    return now && shape.status === 'loading' && now.status !== 'loading' ? now : shape;
  });

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    setShapes(current => {
      futureRef.current = [...futureRef.current, current];
      skipRecordRef.current = true;
      return restore(previous, current);
    });
    setSelectedIds([]);
    forceHistory(n => n + 1);
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    setShapes(current => {
      pastRef.current = [...pastRef.current, current];
      skipRecordRef.current = true;
      return restore(next, current);
    });
    setSelectedIds([]);
    forceHistory(n => n + 1);
  }, []);

  const duplicate = useCallback(() => {
    setShapes(current => {
      const copies = current
        .filter(shape => selectedIds.includes(shape.id) && shape.status !== 'loading')
        .map(shape => ({ ...shape, id: newId(), x: shape.x + 30, y: shape.y + 30, check: undefined }));
      if (copies.length) window.setTimeout(() => setSelectedIds(copies.map(copy => copy.id)), 0);
      return [...current, ...copies];
    });
  }, [selectedIds]);

  // 读取画布、配置、场景
  useEffect(() => {
    loadCanvasBoard().then(board => {
      const restored = board.shapes.map(shape => (shape.status === 'loading' ? { ...shape, status: 'error' as const, error: '生成被中断，请重新生成' } : shape));
      setShapes(restored);
      const rect = boardWrapRef.current?.getBoundingClientRect();
      setCamera(board.camera || (rect ? fitCamera(restored, rect.width, rect.height) : { x: 0, y: 0, z: 1 }));
      setLoaded(true);
    });
    fetchAppConfig().then(config => {
      setModels(config.models);
      setVideoModel(config.models.video_first_frame);
      setGeneration(config.generation);
      if (config.models.image_it2i) fetchImagePrice(config.models.image_it2i).then(setPrice);
    }).catch(() => setNotice('读取模型配置失败，请检查后端是否启动'));
    fetchScenarios().then(list => setScenarios([...list.scenarios].sort((a, b) => a.order - b.order))).catch(() => {});
    fetchSessions().then(list => setRecent(list.slice(0, 5).map((s: any) => ({ id: s.id, title: s.title || s.idea || s.id })))).catch(() => {});
  }, []);

  // 自动保存（去抖）
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => { saveCanvasBoard({ shapes, camera }).catch(() => {}); }, 800);
    return () => window.clearTimeout(timer);
  }, [shapes, camera, loaded]);

  const updateShapes = useCallback((updater: (list: CanvasShape[]) => CanvasShape[]) => setShapes(updater), []);
  const patchShape = useCallback((id: string, patch: Partial<CanvasShape>) => {
    setShapes(list => list.map(shape => (shape.id === id ? { ...shape, ...patch } : shape)));
  }, []);

  const viewportCenter = () => {
    const rect = boardWrapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (rect.width / 2 - camera.x) / camera.z, y: (rect.height / 2 - camera.y) / camera.z };
  };

  /** 新内容在视野外时，把画布移过去 */
  const revealShapes = (added: CanvasShape[], all: CanvasShape[]) => {
    const rect = boardWrapRef.current?.getBoundingClientRect();
    if (!rect || !added.length) return;
    const visible = added.every(s => {
      const sx = s.x * camera.z + camera.x;
      const sy = s.y * camera.z + camera.y;
      return sx >= 0 && sy >= 0 && sx + s.w * camera.z <= rect.width && sy + s.h * camera.z <= rect.height;
    });
    if (!visible) setCamera(fitCamera(all, rect.width, rect.height));
  };

  const addFiles = async (files: File[], world?: { x: number; y: number }) => {
    const origin = world || viewportCenter();
    let x = origin.x;
    for (const file of files) {
      const id = newId();
      const placeholder: CanvasShape = { id, x, y: origin.y, w: 280, h: 280, label: file.name, status: 'loading' };
      setShapes(list => [...list, placeholder]);
      x += 280 + GAP;
      try {
        const [path, dims] = await Promise.all([
          uploadCanvasImage(file),
          new Promise<{ w: number; h: number }>(resolve => {
            const img = new Image();
            img.onload = () => {
              const scale = 320 / Math.max(img.naturalWidth, img.naturalHeight);
              resolve({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
              URL.revokeObjectURL(img.src);
            };
            img.onerror = () => resolve({ w: 280, h: 280 });
            img.src = URL.createObjectURL(file);
          }),
        ]);
        patchShape(id, { src: path, status: 'done', ...dims });
        setSelectedIds([id]);
      } catch (error: any) {
        patchShape(id, { status: 'error', error: error?.message || '上传失败' });
      }
    }
  };

  const handleGenerate = async (jobs: GenerationJob[]) => {
    if (!models) return;
    const placed = placeJobs(shapes, jobs, viewportCenter());
    const all = [...shapes, ...placed];
    setShapes(all);
    revealShapes(placed, all);
    setRunning(n => n + jobs.length);
    const pairs = jobs.map((job, i) => ({ job, shape: placed[i] }));
    await runPool(pairs, MAX_PARALLEL, async ({ job, shape }) => {
      try {
        const paths = job.engine === 'runninghub'
          ? await runningHubImage({ prompt: job.prompt, image: job.reference, ratio: job.ratio })
          : job.reference
          ? await imageToImage({ model: models.image_it2i, prompt: job.prompt, image: job.reference, ratio: job.ratio, ...job.options })
          : await textToImage({ model: models.image_t2i, prompt: job.prompt, ratio: job.ratio, ...job.options });
        if (!paths.length) throw new Error('模型没有返回图片（可能是参数不被支持或额度不足），可以重试或换个比例');
        patchShape(shape.id, { src: paths[0], status: 'done', check: job.checkAgainst ? { status: 'checking' } : undefined });
        if (job.checkAgainst) {
          checkFidelity({ model: models.vlm, reference: job.checkAgainst, generated: paths[0] })
            .then(result => patchShape(shape.id, { check: { status: result.pass ? 'pass' : 'fail', note: result.note } }))
            .catch(() => patchShape(shape.id, { check: { status: 'error', note: '识图检查失败' } }));
        }
      } catch (error: any) {
        patchShape(shape.id, { status: 'error', error: error?.message || '生成失败' });
      } finally {
        setRunning(n => n - 1);
        setGeneratedCount(n => n + 1);
      }
    });
  };

  /** 从生成历史把图放回画布 */
  const addHistoryImage = (path: string, label: string) => {
    const center = viewportCenter();
    const id = newId();
    // 放在已有内容右侧，避免压住别的图
    const x = shapes.length ? Math.max(...shapes.map(s => s.x + s.w)) + GAP : center.x - 160;
    const y = shapes.length ? Math.min(...shapes.map(s => s.y)) : center.y - 160;
    const shape: CanvasShape = { id, src: path, x, y, w: 320, h: 320, label, status: 'done' };
    const img = new Image();
    img.onload = () => {
      const scale = 320 / Math.max(img.naturalWidth, img.naturalHeight);
      patchShape(id, { w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
    };
    img.src = mediaUrl(path);
    const all = [...shapes, shape];
    setShapes(all);
    setSelectedIds([id]);
    revealShapes([shape], all);
  };

  const handleStartVideo = ({ scenario, idea, episodes, auto }: VideoStartRequest) => {
    if (!models) return;
    const defaults = scenario.defaults || {};
    const mode = (defaults.video_generation_mode || generation.video_generation_mode || 'first_frame') as string;
    const activeVideoModel = mode === 'start_end_frame' ? models.video_start_end : mode === 'reference' ? models.video_reference : (videoModel || models.video_first_frame);
    const params = {
      scenario: scenario.id,
      idea,
      style: defaults.style || generation.style || 'realistic',
      video_ratio: defaults.video_ratio || generation.video_ratio || '16:9',
      video_resolution: defaults.video_resolution || generation.video_resolution || '720P',
      llm_model: models.llm,
      vlm_model: models.vlm,
      image_t2i_model: models.image_t2i,
      image_it2i_model: models.image_it2i,
      video_generation_mode: mode,
      video_first_frame_model: videoModel || models.video_first_frame,
      video_start_end_model: models.video_start_end,
      video_reference_model: models.video_reference,
      video_model: activeVideoModel,
      enable_concurrency: true,
      web_search: false,
      episodes,
    };
    try {
      window.sessionStorage.setItem(PENDING_START_KEY, JSON.stringify({ params, auto }));
    } catch {
      setNotice('浏览器禁止了本地存储，无法从画布启动，请到首页开始');
      return;
    }
    router.push('/?start=canvas');
  };

  const selected = shapes.filter(shape => selectedIds.includes(shape.id));

  const emptyState = (
    <div className="sfa-canvas-empty">
      <div className="text-base font-medium text-gray-800">从右侧选一个工作流开始</div>
      <p className="mt-1 text-sm text-gray-400">也可以直接把图片拖进画布。</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {([['single', '出单张'], ['batch', '批量改图'], ['sku', '多款同风格'], ['four', '一套四图']] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setWorkflow(id)} className="sfa-panel-tag !px-3 !py-1.5 !text-sm">{label}</button>
        ))}
      </div>
      <button type="button" onClick={() => fileInputRef.current?.click()} className="mx-auto mt-3 flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700">
        <ImagePlus className="h-3.5 w-3.5" />从电脑选择图片
      </button>
    </div>
  );

  return (
    <div className="sfa-canvas-page flex h-full min-h-0 flex-col min-[900px]:flex-row">
      <div ref={boardWrapRef} className="relative min-h-[45vh] flex-1">
        {loaded && (
          <CanvasBoard
            shapes={shapes}
            onShapesChange={updateShapes}
            selectedIds={selectedIds}
            onSelect={setSelectedIds}
            camera={camera}
            onCameraChange={setCamera}
            onDropFiles={(files, world) => addFiles(files, world)}
            onUndo={undo}
            onRedo={redo}
            onDuplicate={duplicate}
            canUndo={pastRef.current.length > 0}
            canRedo={futureRef.current.length > 0}
            emptyState={emptyState}
          />
        )}
        <div className="absolute left-4 top-4 flex items-center gap-2">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="sfa-canvas-pill">
            <ImagePlus className="h-4 w-4" />添加图片
          </button>
          {running > 0 && <span className="sfa-canvas-pill !cursor-default">正在生成 {running} 张…</span>}
          {notice && <span className="sfa-canvas-pill !cursor-default text-amber-600">{notice}</span>}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/bmp"
          multiple
          className="hidden"
          onChange={event => {
            const files = Array.from(event.target.files || []);
            event.target.value = '';
            if (files.length) addFiles(files);
          }}
        />
      </div>
      <div className="sfa-canvas-panel-wrap min-h-0 border-gray-200 max-[899px]:border-t min-[900px]:w-[380px] min-[900px]:border-l">
        <CanvasPanel
          selected={selected}
          pricePerImage={price}
          busy={false}
          workflow={workflow}
          onWorkflowChange={setWorkflow}
          onGenerate={handleGenerate}
          scenarios={scenarios}
          recentSessions={recent}
          onStartVideo={handleStartVideo}
          videoReady={Boolean(models)}
          imageModelLabel={models ? `文生图 ${models.image_t2i} · 参考图 ${models.image_it2i}` : undefined}
          refreshKey={generatedCount}
          onAddHistoryImage={addHistoryImage}
          currentVideoModel={videoModel}
          onVideoModelChanged={setVideoModel}
        />
      </div>
    </div>
  );
}
