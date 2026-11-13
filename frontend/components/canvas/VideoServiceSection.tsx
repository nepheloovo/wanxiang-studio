'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { checkRunningHubAccount, fetchFirstFrameVideoModels, setDefaultVideoModel, type VideoModelOption } from '@/lib/canvasApi';

const PROVIDER_LABEL: Record<string, string> = {
  dashscope: '阿里百炼 · 通义万相',
  ark: '火山方舟 · Seedance',
  kling: '可灵',
  runninghub: 'RunningHub 工作流',
};

/** 视频服务：选默认的图生视频模型；RunningHub 可直接核查账号 */
export default function VideoServiceSection({ currentModel, onChanged }: { currentModel?: string; onChanged: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<VideoModelOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { fetchFirstFrameVideoModels().then(setModels); }, []);

  const current = models.find(model => model.id === currentModel);

  const change = async (id: string) => {
    setSaving(true);
    setMessage(null);
    try {
      await setDefaultVideoModel(id);
      onChanged(id);
      setMessage({ ok: true, text: '已切换，新建的视频项目会使用这个模型' });
    } catch (error: any) {
      setMessage({ ok: false, text: error?.message || '切换失败' });
    } finally {
      setSaving(false);
    }
  };

  const check = async () => {
    setMessage(null);
    try {
      setMessage({ ok: true, text: await checkRunningHubAccount() });
    } catch (error: any) {
      setMessage({ ok: false, text: error?.message || '核查失败' });
    }
  };

  return (
    <section className="sfa-card-soft">
      <button type="button" onClick={() => setOpen(value => !value)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left" aria-expanded={open}>
        <span className="min-w-0">
          <span className="block text-xs font-medium text-gray-500">视频服务</span>
          <span className="block truncate text-sm text-gray-700">{current ? `${current.label}（${PROVIDER_LABEL[current.provider] || current.provider}）` : currentModel || '读取中…'}</span>
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2.5 px-3 pb-3">
          <select value={currentModel || ''} disabled={saving} onChange={event => change(event.target.value)} className="sfa-panel-input w-full">
            {Object.entries(
              models.reduce<Record<string, VideoModelOption[]>>((groups, model) => {
                (groups[model.provider] ||= []).push(model);
                return groups;
              }, {}),
            ).map(([provider, list]) => (
              <optgroup key={provider} label={PROVIDER_LABEL[provider] || provider}>
                {list.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.label}{model.price_per_second ? ` · ¥${model.price_per_second}/秒` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="text-xs leading-5 text-gray-400">
            切换的是「首帧生视频」默认模型。各服务的 Key 在<Link href="/settings" className="mx-0.5 text-gray-600 underline">设置</Link>里填写；RunningHub 还需要填工作流 ID 和节点编号。
          </p>
          {current?.provider === 'runninghub' && (
            <button type="button" onClick={check} className="sfa-btn-outline sfa-btn-sm">核查 RunningHub 账号 / 余额</button>
          )}
          {message && <p className={`text-xs ${message.ok ? 'text-green-600' : 'text-red-600'}`}>{message.text}</p>}
        </div>
      )}
    </section>
  );
}
