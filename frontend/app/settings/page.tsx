'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, ChevronDown, Loader2, Save, XCircle } from 'lucide-react';
import BrandHeader from '@/components/BrandHeader';
import { fetchModelGroupsByType, fetchVideoModelGroupsByAbility } from '@/lib/modelRegistry';
import {
  VIDEO_RATIOS,
  VIDEO_RESOLUTIONS,
  VIDEO_GENERATION_MODES,
  STYLES,
  type ProviderGroup,
} from '@/config/models';

type ConfigTree = Record<string, any>;

type Field = {
  path: string;
  label: string;
  type?: 'text' | 'number' | 'boolean' | 'password' | 'select';
  options?: Array<{ id: string; label: string }> | ProviderGroup[];
};

type ModelSelectKey = 'llm' | 'vlm' | 'image_it2i' | 'image_t2i' | 'video_first_frame' | 'video_start_end' | 'video_reference';

const EMPTY_MODEL_SELECTS: Record<ModelSelectKey, ProviderGroup[]> = {
  llm: [],
  vlm: [],
  image_it2i: [],
  image_t2i: [],
  video_first_frame: [],
  video_start_end: [],
  video_reference: [],
};

const LOG_LEVEL_OPTIONS = [
  { id: 'DEBUG', label: '最详细（排查问题用）' },
  { id: 'INFO', label: '常规（推荐）' },
  { id: 'WARNING', label: '只记警告和错误' },
  { id: 'ERROR', label: '只记错误' },
  { id: 'CRITICAL', label: '只记严重错误' },
];

type ProviderCard = {
  id: string;
  name: string;
  hint: string;
  keyFields: Field[];
  advancedFields: Field[];
};

/** 模型服务账号：常用的放前面；只露出 Key，接口地址 / 代理放进高级设置 */
const PROVIDERS: ProviderCard[] = [
  {
    id: 'dashscope',
    name: '阿里云百炼',
    hint: '通义千问（写剧本）、通义万相（画图、视频）',
    keyFields: [{ path: 'api_providers.dashscope.api_key', label: 'API Key', type: 'password' }],
    advancedFields: [
      { path: 'api_providers.dashscope.base_url', label: '接口地址' },
      { path: 'api_providers.dashscope.enable_proxy', label: '通过代理访问', type: 'boolean' },
    ],
  },
  {
    id: 'ark',
    name: '火山方舟',
    hint: '豆包 Seedream（画图）、Seedance（视频）',
    keyFields: [{ path: 'api_providers.ark.api_key', label: 'API Key', type: 'password' }],
    advancedFields: [
      { path: 'api_providers.ark.base_url', label: '接口地址' },
      { path: 'api_providers.ark.enable_proxy', label: '通过代理访问', type: 'boolean' },
    ],
  },
  {
    id: 'kling',
    name: '可灵',
    hint: '可灵视频生成',
    keyFields: [
      { path: 'api_providers.kling.access_key', label: 'Access Key', type: 'password' },
      { path: 'api_providers.kling.secret_key', label: 'Secret Key', type: 'password' },
    ],
    advancedFields: [
      { path: 'api_providers.kling.base_url', label: '接口地址' },
      { path: 'api_providers.kling.enable_proxy', label: '通过代理访问', type: 'boolean' },
    ],
  },
  {
    id: 'runninghub',
    name: 'RunningHub',
    hint: '运行你在 RunningHub 上的图生视频工作流（如 Seedance、Wan 工作流）。节点编号在工作流页面查看',
    keyFields: [
      { path: 'api_providers.runninghub.api_key', label: 'API Key', type: 'password' },
      { path: 'api_providers.runninghub.workflow_id', label: '工作流 ID' },
      { path: 'api_providers.runninghub.image_node_id', label: '首帧图片节点编号' },
      { path: 'api_providers.runninghub.prompt_node_id', label: '提示词节点编号' },
    ],
    advancedFields: [
      { path: 'api_providers.runninghub.base_url', label: '接口地址' },
      { path: 'api_providers.runninghub.image_field', label: '图片字段名（默认 image）' },
      { path: 'api_providers.runninghub.prompt_field', label: '提示词字段名（默认 text）' },
      { path: 'api_providers.runninghub.duration_node_id', label: '时长节点编号（选填）' },
      { path: 'api_providers.runninghub.duration_field', label: '时长字段名（默认 duration）' },
      { path: 'api_providers.runninghub.enable_proxy', label: '通过代理访问', type: 'boolean' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    hint: 'DeepSeek 文本模型',
    keyFields: [{ path: 'api_providers.deepseek.api_key', label: 'API Key', type: 'password' }],
    advancedFields: [
      { path: 'api_providers.deepseek.base_url', label: '接口地址' },
      { path: 'api_providers.deepseek.enable_proxy', label: '通过代理访问', type: 'boolean' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    hint: 'GPT 系列（国内通常需要代理）',
    keyFields: [{ path: 'api_providers.openai.api_key', label: 'API Key', type: 'password' }],
    advancedFields: [
      { path: 'api_providers.openai.base_url', label: '接口地址' },
      { path: 'api_providers.openai.enable_proxy', label: '通过代理访问', type: 'boolean' },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    hint: 'Gemini 系列（国内通常需要代理）',
    keyFields: [{ path: 'api_providers.gemini.api_key', label: 'API Key', type: 'password' }],
    advancedFields: [
      { path: 'api_providers.gemini.base_url', label: '接口地址' },
      { path: 'api_providers.gemini.enable_proxy', label: '通过代理访问', type: 'boolean' },
    ],
  },
];

/** 默认模型：用大白话说明每个模型用在哪 */
const MODEL_FIELDS: Array<Field & { key: ModelSelectKey; use: string }> = [
  { key: 'llm', use: '文字', path: 'models.llm', label: '写剧本、分镜', type: 'select' },
  { key: 'vlm', use: '看图', path: 'models.vlm', label: '检查画面', type: 'select' },
  { key: 'image_t2i', use: '图片', path: 'models.image_t2i', label: '画图（文字生成图片）', type: 'select' },
  { key: 'image_it2i', use: '图片', path: 'models.image_it2i', label: '改图（参考图片生成）', type: 'select' },
  { key: 'video_first_frame', use: '视频', path: 'models.video_first_frame', label: '视频（用首帧画面生成）', type: 'select' },
  { key: 'video_start_end', use: '视频', path: 'models.video_start_end', label: '视频（用首尾两帧生成）', type: 'select' },
  { key: 'video_reference', use: '视频', path: 'models.video_reference', label: '视频（用参考图生成）', type: 'select' },
];

const GENERATION_FIELDS: Field[] = [
  { path: 'generation.style', label: '画面风格', type: 'select', options: STYLES },
  { path: 'generation.video_ratio', label: '画面比例', type: 'select', options: VIDEO_RATIOS },
  { path: 'generation.video_resolution', label: '清晰度', type: 'select', options: VIDEO_RESOLUTIONS },
  { path: 'generation.video_generation_mode', label: '视频生成方式', type: 'select', options: VIDEO_GENERATION_MODES },
];

const ADVANCED_GROUPS: Array<{ title: string; description: string; fields: Field[] }> = [
  {
    title: '网络代理',
    description: '只有访问海外服务（OpenAI、Gemini）时才需要。填好后在对应服务里打开「通过代理访问」。',
    fields: [{ path: 'api_providers.common.proxy', label: '代理地址，例如 http://127.0.0.1:7890' }],
  },
  {
    title: '其他兼容服务',
    description: '接入 vLLM、Ollama、OpenRouter 等兼容 OpenAI 的服务。模型需要在 config.yaml 的 custom_models 里登记。',
    fields: [
      { path: 'api_providers.openai_compatible.api_key', label: 'API Key', type: 'password' },
      { path: 'api_providers.openai_compatible.base_url', label: '接口地址' },
      { path: 'api_providers.openai_compatible.enable_proxy', label: '通过代理访问', type: 'boolean' },
    ],
  },
  {
    title: '后端服务',
    description: '地址和端口修改后需要重启后端才生效，一般不用动。',
    fields: [
      { path: 'server.host', label: '地址' },
      { path: 'server.port', label: '端口', type: 'number' },
      { path: 'server.log_level', label: '日志详细程度', type: 'select', options: LOG_LEVEL_OPTIONS },
      { path: 'server.access_log', label: '记录每次请求', type: 'boolean' },
      { path: 'api_providers.common.print_model_input', label: '在日志里打印发给模型的内容', type: 'boolean' },
    ],
  },
];

function getValue(config: ConfigTree, path: string) {
  return path.split('.').reduce((current, key) => current?.[key], config);
}

function setValue(config: ConfigTree, path: string, value: any): ConfigTree {
  const next = structuredClone(config || {});
  const parts = path.split('.');
  let current = next;
  for (const part of parts.slice(0, -1)) {
    current[part] = current[part] || {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
  return next;
}

function formatConfigPath(path: string) {
  if (!path) return 'backend/config.yaml';
  const normalized = path.replace(/\\/g, '/');
  // 仓库结构为 <repo>/backend、<repo>/frontend：显示相对仓库根目录的路径
  const backendIndex = normalized.lastIndexOf('/backend/');
  if (backendIndex >= 0) return normalized.slice(backendIndex + 1);
  return normalized;
}

function maskSecret(value: unknown) {
  const text = String(value ?? '');
  if (!text) return '';
  if (text.length <= 10) return '*'.repeat(text.length);
  return `${text.slice(0, 5)}${'*'.repeat(Math.min(12, text.length - 10))}${text.slice(-5)}`;
}

function selectHasValue(options: unknown, value: string): boolean {
  if (!Array.isArray(options)) return false;
  return options.some((item: any) => (Array.isArray(item?.models)
    ? item.models.some((model: any) => model.id === value)
    : String(item?.id ?? item?.value ?? item) === value));
}

function isProviderOptions(options: Field['options']): options is ProviderGroup[] {
  return Array.isArray(options) && options.some(option => 'models' in option);
}

export default function SettingsPage() {
  const [config, setConfig] = useState<ConfigTree>({});
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [modelSelects, setModelSelects] = useState<Record<ModelSelectKey, ProviderGroup[]>>(EMPTY_MODEL_SELECTS);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const resp = await fetch('/api/config');
        if (!resp.ok) throw new Error('读取配置失败');
        const data = await resp.json();
        setConfig(data.config || {});
        setPath(data.path || '');
        setSecretDrafts({});
      } catch (e: any) {
        setError(e.message || '读取配置失败');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchModelGroupsByType('llm'),
      fetchModelGroupsByType('vlm'),
      fetchModelGroupsByType('i2i'),
      fetchModelGroupsByType('t2i'),
      fetchVideoModelGroupsByAbility('first_frame_i2v'),
      fetchVideoModelGroupsByAbility('start_end_frame_i2v'),
      fetchVideoModelGroupsByAbility('reference_to_video'),
    ])
      .then(([llm, vlm, imageIt2i, imageT2i, firstFrameVideo, startEndVideo, referenceVideo]) => {
        if (cancelled) return;
        setModelSelects({
          llm,
          vlm,
          image_it2i: imageIt2i,
          image_t2i: imageT2i,
          video_first_frame: firstFrameVideo,
          video_start_end: startEndVideo,
          video_reference: referenceVideo,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const [showAdvanced, setShowAdvanced] = useState(false);

  /** 某个模型 id 属于哪个服务 */
  const providerOfModel = (modelId: string): string | undefined => {
    for (const groups of Object.values(modelSelects)) {
      for (const group of groups) {
        if (group.models.some(model => model.id === modelId)) return group.provider;
      }
    }
    return undefined;
  };

  /** 当前默认模型用到的服务，以及它们服务于哪些用途 */
  const providerUsage: Record<string, string[]> = {};
  for (const field of MODEL_FIELDS) {
    const modelId = String(getValue(config, field.path) || '');
    const provider = modelId ? providerOfModel(modelId) : undefined;
    if (!provider) continue;
    const uses = (providerUsage[provider] ||= []);
    if (!uses.includes(field.use)) uses.push(field.use);
  }

  const keyFilled = (card: ProviderCard) => card.keyFields.every(field => String(getValue(config, field.path) || '').trim() !== '');
  const missingProviders = PROVIDERS.filter(card => providerUsage[card.id] && !keyFilled(card));

  const updateField = (field: Field, raw: string | boolean) => {
    const value = field.type === 'number' ? Number(raw) || 0 : raw;
    setConfig(current => setValue(current, field.path, value));
  };

  const save = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const resp = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: config }),
      });
      if (!resp.ok) throw new Error('保存配置失败');
      const data = await resp.json();
      setConfig(data.config || {});
      setPath(data.path || '');
      setSecretDrafts({});
      setMessage('已保存');
    } catch (e: any) {
      setError(e.message || '保存配置失败');
    } finally {
      setSaving(false);
    }
  };

  const updateSecretField = (field: Field, raw: string) => {
    setSecretDrafts(current => ({ ...current, [field.path]: raw }));
    setConfig(current => setValue(current, field.path, raw));
  };

  const renderInput = (field: Field, options?: Field['options']) => {
    const value = getValue(config, field.path);
    if (field.type === 'boolean') {
      const on = Boolean(value);
      return (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => updateField(field, !on)}
          className="flex h-10 items-center gap-2 text-sm text-gray-600"
        >
          <span className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${on ? 'bg-neutral-900' : 'bg-gray-200'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </span>
          {on ? '已开启' : '已关闭'}
        </button>
      );
    }
    if (field.type === 'select') {
      const opts = options ?? field.options;
      return (
        <select
          value={String(value ?? '')}
          onChange={event => updateField(field, event.target.value)}
          className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none focus:border-neutral-300"
        >
          {value !== undefined && value !== null && String(value) !== '' && !selectHasValue(opts, String(value)) && (
            <option value={String(value)}>{String(value)}（当前配置）</option>
          )}
          {isProviderOptions(opts) ? (
            opts.map(group => (
              <optgroup key={group.provider} label={group.label}>
                {group.models.map(model => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </optgroup>
            ))
          ) : (
            (opts || []).map(option => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))
          )}
        </select>
      );
    }
    if (field.type === 'password') {
      return (
        <input
          type="password"
          value={secretDrafts[field.path] ?? maskSecret(value)}
          onFocus={event => event.currentTarget.select()}
          onChange={event => updateSecretField(field, event.target.value)}
          placeholder="粘贴你的 Key"
          autoComplete="off"
          className="h-10 rounded-lg border border-gray-200 bg-white px-3 font-mono text-sm text-gray-700 outline-none focus:border-neutral-300"
        />
      );
    }
    return (
      <input
        type={field.type === 'number' ? 'number' : 'text'}
        value={String(value ?? '')}
        onChange={event => updateField(field, event.target.value)}
        className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none focus:border-neutral-300"
      />
    );
  };

  const renderField = (field: Field, options?: Field['options']) => (
    <label key={field.path} className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-gray-500">{field.label}</span>
      {renderInput(field, options)}
    </label>
  );

  return (
    <div className="min-h-screen bg-gray-50/50">
      <BrandHeader title="设置" />
      <main className="mx-auto w-full max-w-4xl px-4 pb-12 pt-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">设置</h1>
          <p className="mt-1 text-sm text-gray-500">填好模型服务的 Key 就能开始创作。改完记得点底部的「保存」。</p>
        </div>

        {loading ? (
          <div className="flex h-56 items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在读取配置
          </div>
        ) : (
          <div className="space-y-5">
            {missingProviders.length > 0 && (
              <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
                <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>
                  现在默认用到的 {missingProviders.map(card => `「${card.name}」`).join('、')} 还没填 Key，生成时会失败。请在下方填写，或换成已填 Key 的模型。
                </span>
              </div>
            )}

            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-800">1. 模型服务账号</h2>
              <p className="mt-1 text-xs text-gray-500">AI 能力来自这些服务。至少填一个，推荐阿里云百炼（文字、图片、视频都能用）。</p>
              <div className="mt-4 divide-y divide-gray-100">
                {PROVIDERS.map(card => {
                  const filled = keyFilled(card);
                  const usage = providerUsage[card.id];
                  return (
                    <div key={card.id} className="grid grid-cols-1 gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[200px_1fr]">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800">{card.name}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${filled ? 'bg-green-50 text-green-600' : usage ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-400'}`}>
                            {filled ? '已填写' : usage ? '需要填写' : '未填写'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">{card.hint}</p>
                        {usage && <p className="mt-1 text-xs text-gray-500">正在用于：{usage.join('、')}</p>}
                      </div>
                      <div className={`grid gap-3 ${card.keyFields.length > 1 ? 'sm:grid-cols-2' : ''}`}>
                        {card.keyFields.map(field => renderField(field))}
                        {card.id === 'runninghub' && <RunningHubCheck />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-800">2. 默认使用的模型</h2>
              <p className="mt-1 text-xs text-gray-500">每次新建作品时默认用这些模型，创作时也可以临时更换。</p>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {MODEL_FIELDS.map(field => renderField(field, modelSelects[field.key]))}
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-800">3. 默认画面效果</h2>
              <p className="mt-1 text-xs text-gray-500">各类型作品有自己的默认值，这里是兜底设置。</p>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {GENERATION_FIELDS.map(field => renderField(field))}
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <button
                type="button"
                onClick={() => setShowAdvanced(value => !value)}
                className="flex w-full items-center justify-between text-left"
                aria-expanded={showAdvanced}
              >
                <span>
                  <span className="block text-sm font-semibold text-gray-800">高级设置</span>
                  <span className="mt-1 block text-xs text-gray-500">接口地址、网络代理、后端服务。一般不用改。</span>
                </span>
                <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              </button>
              {showAdvanced && (
                <div className="mt-5 space-y-6">
                  {ADVANCED_GROUPS.map(group => (
                    <div key={group.title}>
                      <h3 className="text-xs font-semibold text-gray-700">{group.title}</h3>
                      <p className="mt-1 text-xs text-gray-400">{group.description}</p>
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        {group.fields.map(field => renderField(field))}
                      </div>
                    </div>
                  ))}
                  <div>
                    <h3 className="text-xs font-semibold text-gray-700">各服务的接口地址</h3>
                    <p className="mt-1 text-xs text-gray-400">用官方服务时保持默认即可。</p>
                    <div className="mt-3 space-y-3">
                      {PROVIDERS.map(card => (
                        <div key={card.id} className="grid grid-cols-1 gap-3 md:grid-cols-[120px_1fr_160px] md:items-end">
                          <span className="pb-2.5 text-xs text-gray-500">{card.name}</span>
                          {card.advancedFields.map(field => renderField(field))}
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">配置文件位置：<span className="font-mono">{formatConfigPath(path)}</span></p>
                </div>
              )}
            </section>

            <div className="sticky bottom-4 flex items-center gap-3 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
              {message && (
                <span className="flex items-center gap-1.5 text-sm text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  {message}
                </span>
              )}
              {error && (
                <span className="flex items-center gap-1.5 text-sm text-red-600">
                  <XCircle className="h-4 w-4" />
                  {error}
                </span>
              )}
              <button
                onClick={save}
                disabled={saving}
                className="ml-auto flex items-center gap-2 rounded-xl bg-neutral-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-gray-200"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/** 核查 RunningHub 账号：只查 Key 是否可用和余额，不发起生成 */
function RunningHubCheck() {
  const [state, setState] = useState<{ loading: boolean; text: string; ok?: boolean }>({ loading: false, text: '' });
  const check = async () => {
    setState({ loading: true, text: '' });
    try {
      const resp = await fetch('/api/providers/runninghub/account', { method: 'POST' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.detail || '核查失败');
      const account = data.account || {};
      const balance = account.remainCoins ?? account.remainMoney ?? account.balance;
      setState({ loading: false, ok: true, text: balance !== undefined ? `连接正常，剩余：${balance}` : '连接正常' });
    } catch (error: any) {
      setState({ loading: false, ok: false, text: error?.message || '核查失败' });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
      <button type="button" onClick={check} disabled={state.loading} className="sfa-btn-outline">
        {state.loading ? '核查中…' : '核查账号 / 余额'}
      </button>
      <span className="text-xs text-gray-400">先保存配置再核查；只查询账号，不会生成内容。</span>
      {state.text && <span className={`text-xs ${state.ok ? 'text-green-600' : 'text-red-600'}`}>{state.text}</span>}
    </div>
  );
}
