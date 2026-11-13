'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { FolderOpen, Loader2, Plus, Trash2 } from 'lucide-react';
import BrandHeader from '@/components/BrandHeader';
import { deletePipelineTask, deleteSession, fetchPipelineTasks, fetchScenarios, fetchSessions, type PipelineTask } from '@/lib/workflowApi';
import { doneStageCount, projectState, stageLabel, totalStageCount, type StageNameMap } from '@/lib/sessionState';

const STATE_TEXT = {
  running: { label: '生成中', cls: 'bg-cream/5 text-neutral-900' },
  waiting: { label: '待你确认', cls: 'bg-amber-50 text-amber-600' },
  done: { label: '已完成', cls: 'bg-green-50 text-green-600' },
  failed: { label: '出错了', cls: 'bg-red-50 text-red-600' },
  new: { label: '未开始', cls: 'bg-gray-100 text-gray-500' },
} as const;

const PIPELINE_INFO: Record<string, { href: string; label: string }> = {
  standard: { href: '/pipelines/standard', label: '文艺短视频' },
  action_transfer: { href: '/pipelines/action-transfer', label: '动作迁移' },
  digital_human: { href: '/pipelines/digital-human', label: '数字人口播' },
};

const PIPELINE_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '排队中', cls: 'bg-gray-100 text-gray-500' },
  running: { label: '生成中', cls: 'bg-cream/5 text-neutral-900' },
  completed: { label: '已完成', cls: 'bg-green-50 text-green-600' },
  failed: { label: '出错了', cls: 'bg-red-50 text-red-600' },
};

function formatDate(value: unknown): string {
  const num = typeof value === 'number' ? value : Number(value);
  const date = Number.isFinite(num) && num > 0 ? new Date(num < 1e12 ? num * 1000 : num) : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pipelineTitle(task: PipelineTask): string {
  const input = task.input || {};
  const output = task.output || {};
  return String(output.title || input.title || input.goods_title || input.text || input.prompt_text || input.goods_text || '未命名任务');
}

export default function ProjectsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  const [sessions, setSessions] = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<PipelineTask[]>([]);
  const [scenarioNames, setScenarioNames] = useState<Record<string, string>>({});
  const [stageNames, setStageNames] = useState<StageNameMap>({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    const [sessionList, pipelineList] = await Promise.all([
      fetchSessions().catch(() => []),
      fetchPipelineTasks(100).catch(() => []),
    ]);
    setSessions(sessionList);
    setPipelines(pipelineList.filter(task => PIPELINE_INFO[task.pipeline]));
    setLoading(false);
  };

  useEffect(() => {
    fetchScenarios()
      .then(list => {
        const names: Record<string, string> = {};
        const stages: StageNameMap = {};
        list.scenarios.forEach((scenario: any) => {
          names[scenario.id] = scenario.name;
          (scenario.stages || []).forEach((stage: any) => {
            stages[`${scenario.id}:${stage.id}`] = stage.short_name || stage.name;
            if (!stages[stage.id]) stages[stage.id] = stage.short_name || stage.name;
          });
        });
        setScenarioNames(names);
        setStageNames(stages);
      })
      .catch(() => {});
    load().catch(() => setLoading(false));
    const timer = window.setInterval(() => load().catch(() => {}), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const sorted = useMemo(
    () => [...sessions].sort((a, b) => Number(b.date || 0) - Number(a.date || 0)),
    [sessions],
  );

  const handleDeleteSession = async (session: any) => {
    const name = session.title || session.idea || '这个项目';
    if (!window.confirm(`删除「${String(name).slice(0, 30)}」？删除后无法恢复。`)) return;
    setDeleting(session.id);
    try {
      await deleteSession(session.id);
      setSessions(list => list.filter(item => item.id !== session.id));
    } catch (error: any) {
      window.alert(error?.message || '删除失败');
    } finally {
      setDeleting(null);
    }
  };

  const handleDeletePipeline = async (task: PipelineTask) => {
    if (!window.confirm(`删除「${pipelineTitle(task).slice(0, 30)}」？删除后无法恢复。`)) return;
    setDeleting(task.task_id);
    try {
      await deletePipelineTask(task.task_id);
      setPipelines(list => list.filter(item => item.task_id !== task.task_id));
    } catch (error: any) {
      window.alert(error?.message || '删除失败');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className={embedded ? '' : 'min-h-screen bg-gray-50'}>
      {!embedded && <BrandHeader title="我的作品" />}
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{embedded ? '视频项目' : '我的作品'}</h1>
            <p className="mt-1 text-sm text-gray-500">所有创作过的视频项目都在这里，点开可以继续做。</p>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 flex-shrink-0 items-center gap-1.5 rounded-xl bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700"
          >
            <Plus className="h-4 w-4" />
            新建项目
          </Link>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-gray-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : sorted.length === 0 && pipelines.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 text-center">
            <FolderOpen className="mb-3 h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-500">还没有作品</p>
            <Link href="/" className="mt-3 text-sm font-medium text-gray-900 underline underline-offset-4">去写下第一个想法</Link>
          </div>
        ) : (
          <>
            {sorted.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {sorted.map(session => {
                  const state = projectState(session);
                  const badge = STATE_TEXT[state.kind];
                  const done = doneStageCount(session);
                  const total = totalStageCount(session);
                  const stageName = state.stage ? stageLabel(state.stage, session, stageNames) : '';
                  const hint = state.kind === 'running'
                    ? `正在生成：${stageName}`
                    : state.kind === 'waiting'
                      ? `「${stageName}」已完成，等你确认`
                      : state.kind === 'failed'
                        ? `「${stageName}」出错，可重试`
                        : state.kind === 'done' ? '全部步骤已完成' : '还没开始生成';
                  const href = `/?session=${encodeURIComponent(session.id)}${state.stage ? `&stage=${encodeURIComponent(state.stage)}` : ''}`;
                  return (
                    <div
                      key={session.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(href)}
                      onKeyDown={event => { if (event.key === 'Enter') router.push(href); }}
                      className="group cursor-pointer rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-cream/20"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base font-semibold text-gray-900">{session.title || session.idea || '未命名作品'}</div>
                          {session.title && session.idea && (
                            <div className="mt-0.5 truncate text-xs text-gray-400">{session.idea}</div>
                          )}
                        </div>
                        <span className={clsx('flex-shrink-0 rounded-md px-2 py-0.5 text-xs', badge.cls)}>{badge.label}</span>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-neutral-900" style={{ width: `${Math.round((done / total) * 100)}%` }} />
                        </div>
                        <span className="text-xs text-gray-400">{done}/{total} 步</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-500">
                        <span className="truncate">{hint}</span>
                        <span className="flex flex-shrink-0 items-center gap-2 text-gray-400">
                          {scenarioNames[session.scenario] || ''}
                          {session.date ? <span>· {formatDate(session.date)}</span> : null}
                          <button
                            type="button"
                            onClick={event => { event.stopPropagation(); handleDeleteSession(session); }}
                            disabled={deleting === session.id}
                            className="rounded-md p-1 text-gray-300 opacity-60 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                            title="删除"
                            aria-label="删除作品"
                          >
                            {deleting === session.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {pipelines.length > 0 && (
              <div className="mt-10">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">快捷工具生成的视频</h2>
                <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
                  {pipelines.map(task => {
                    const info = PIPELINE_INFO[task.pipeline];
                    const status = PIPELINE_STATUS[task.status] || PIPELINE_STATUS.pending;
                    return (
                      <div key={task.task_id} className="flex items-center gap-3 px-4 py-3">
                        <Link href={`${info.href}?task=${encodeURIComponent(task.task_id)}`} className="min-w-0 flex-1 hover:opacity-80">
                          <div className="truncate text-sm font-medium text-gray-800">{pipelineTitle(task)}</div>
                          <div className="mt-0.5 text-xs text-gray-400">{info.label}</div>
                        </Link>
                        <span className={clsx('flex-shrink-0 rounded-md px-2 py-0.5 text-xs', status.cls)}>{status.label}</span>
                        <button
                          type="button"
                          onClick={() => handleDeletePipeline(task)}
                          disabled={deleting === task.task_id}
                          className="rounded-md p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-600"
                          title="删除"
                          aria-label="删除任务"
                        >
                          {deleting === task.task_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
