/* 画布右侧面板用到的预设：平台尺寸、风格、提示词快捷标签 */

export interface PlatformPreset {
  id: string;
  label: string;
  ratio: string;
  hint: string;
}

/** 平台 / 用途 → 画面比例。实际像素由所选模型决定 */
export const PLATFORM_PRESETS: PlatformPreset[] = [
  { id: 'square', label: '通用方图 · 1:1', ratio: '1:1', hint: '适合大多数场景。' },
  { id: 'ecom-main', label: '淘宝 / 天猫 / 京东 / 拼多多 主图 · 1:1', ratio: '1:1', hint: '电商主图，商品居中、留白充足。' },
  { id: 'white-bg', label: '电商白底图 · 1:1', ratio: '1:1', hint: '纯白背景，适合平台白底图要求。' },
  { id: 'amazon', label: 'Amazon 白底主图 · 1:1', ratio: '1:1', hint: '纯白背景，商品占画面约 85%。' },
  { id: 'taobao-portrait', label: '淘宝 / 天猫 竖版主图 · 3:4', ratio: '3:4', hint: '竖版主图，手机端展示面积更大。' },
  { id: 'xhs', label: '小红书笔记图 · 3:4', ratio: '3:4', hint: '生活化、有氛围的种草图。' },
  { id: 'detail', label: '详情页单屏 · 3:4', ratio: '3:4', hint: '详情页的一屏，上方可留文案区。' },
  { id: 'douyin', label: '抖音 / 视频号 竖屏 · 9:16', ratio: '9:16', hint: '竖屏封面或分镜。' },
  { id: 'banner', label: '横版海报 / Banner · 16:9', ratio: '16:9', hint: '横版海报、店铺 Banner。' },
  { id: 'landscape', label: '横图 · 4:3', ratio: '4:3', hint: '通用横图。' },
];

export const STYLE_OPTIONS: Array<{ id: string; label: string; suffix: string }> = [
  { id: 'none', label: '无风格', suffix: '' },
  { id: 'photo', label: '真实摄影', suffix: '真实摄影风格，自然光影，细节清晰' },
  { id: 'product', label: '商业产品', suffix: '商业产品摄影，棚拍布光，质感高级' },
  { id: 'illustration', label: '精致插画', suffix: '精致插画风格，色彩干净' },
  { id: 'poster', label: '海报视觉', suffix: '海报视觉风格，构图有冲击力，留出标题区域' },
];

export const SINGLE_PROMPT_CHIPS: Array<{ label: string; text: string }> = [
  { label: '商品白底图', text: '白底棚拍商品图，纯白背景，商品完整居中，柔和均匀布光，高清' },
  { label: '商品场景图', text: '商品使用场景图，自然光，生活化氛围，商品为视觉中心，高清' },
  { label: '小红书种草', text: '小红书种草笔记图，生活化场景，自然柔光，真实有氛围，高清' },
  { label: '短视频分镜', text: '竖屏短视频分镜画面，电影感构图，高清' },
];

export const BATCH_PROMPT_CHIPS: Array<{ label: string; text: string }> = [
  { label: '换纯白背景', text: '把背景换成纯白色，商品保持不变、完整居中，柔和均匀布光' },
  { label: '放进生活场景', text: '把商品放进真实的生活使用场景，自然光，商品保持不变并作为视觉中心' },
  { label: '小红书风格', text: '改成小红书种草图风格，生活化氛围，自然柔光，商品保持不变' },
  { label: '棚拍质感', text: '改成专业棚拍效果，柔和布光，质感高级，商品保持不变' },
];

/** 一套四图：白底图固定 1:1，其余跟随所选平台比例 */
export const FOUR_SET = [
  { key: 'white', label: '白底图', fixedRatio: '1:1', prompt: '参考图中的同一款商品，纯白背景棚拍，商品完整居中，柔和均匀布光，无多余道具，高清' },
  { key: 'scene', label: '场景图', prompt: '参考图中的同一款商品，放在真实的使用场景中，自然光，生活化氛围，商品为视觉中心，高清' },
  { key: 'detail', label: '细节图', prompt: '参考图中的同一款商品的局部特写，展示材质、做工和关键细节，微距质感，高清' },
  { key: 'selling', label: '卖点图', prompt: '参考图中的同一款商品的卖点展示图，商品在画面一侧，另一侧留出干净的文案区域，高清' },
] as const;

/** 由比例算出画布上的显示尺寸（世界坐标） */
export function sizeForRatio(ratio: string, base = 320): { w: number; h: number } {
  const [a, b] = ratio.split(':').map(Number);
  if (!a || !b) return { w: base, h: base };
  return a >= b ? { w: base, h: Math.round((base * b) / a) } : { w: Math.round((base * a) / b), h: base };
}
