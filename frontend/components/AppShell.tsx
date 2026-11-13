'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CheckCircle2, ChevronDown, Clapperboard, Clock, Hexagon, Home, Images, ListChecks, Loader2, Repeat2, Settings, Square, Trash2, UserRound, Wrench } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { clearTempCache, fetchPipelineTasks, fetchSandboxTasks, fetchScenarios, fetchSessions, type PipelineTask, type SandboxTask } from '@/lib/workflowApi';
import { sessionReviewState, stageLabel, type StageNameMap } from '@/lib/sessionState';
import { brand } from '@/config/brand';

/** 顶部主导航：首页（分步创作）/ 画布 / 作品 */
const MAIN_NAV: Array<{ href: string; label: string; icon: typeof Home }> = [
  { href: '/', label: '首页', icon: Home },
  { href: '/canvas', label: '画布', icon: Square },
  { href: '/projects', label: '作品', icon: Images },
];

/** 「工具」下拉：一键快捷工具 + 单项能力 */
const TOOL_ITEMS: Array<{ href: string; label: string; desc: string; icon: typeof Home }> = [
  { href: '/pipelines/standard', label: '文艺短视频', desc: '一段文字直接出短视频', icon: Clapperboard },
  { href: '/pipelines/digital-human', label: '数字人口播', desc: '人像 + 文案生成口播', icon: UserRound },
  { href: '/pipelines/action-transfer', label: '动作迁移', desc: '让图中人物做视频里的动作', icon: Repeat2 },
  { href: '/sandbox', label: 'AI 工具箱', desc: '单独试用文字、看图、画图、视频', icon: Hexagon },
];

const SETTINGS_ITEM = { href: '/settings', label: '设置', icon: Settings };

const PIPELINE_ROUTES: Record<string, { href: string; label: string }> = {
  standard: { href: '/pipelines/standard', label: '文艺短视频' },
  action_transfer: { href: '/pipelines/action-transfer', label: '动作迁移' },
  digital_human: { href: '/pipelines/digital-human', label: '数字人口播' },
};

const TASK_STATUS_STYLE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-500',
  running: 'bg-cream/5 text-neutral-900',
  waiting: 'bg-amber-50 text-amber-600',
  completed: 'bg-green-50 text-green-600',
  failed: 'bg-red-50 text-red-600',
};

function statusText(status?: string) {
  if (status === 'pending') return '等待中';
  if (status === 'running') return '生成中';
  if (status === 'waiting') return '待确认';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  return status || '未知';
}

function taskTitle(task: PipelineTask) {
  const input = task.input || {};
  const output = task.output || {};
  return output.title || input.title || input.goods_title || input.text || input.prompt_text || input.goods_text || task.task_id;
}

type RunningTaskItem = {
  id: string;
  href: string;
  title: string;
  scope: string;
  status: string;
  progress: number;
};

const COMPLETED_TASK_DISMISS_KEY = `${brand.storagePrefix}.dismissed-completed-tasks`;

/** 会话所属场景的阶段数：优先用 stage_ids，旧数据回退到 status 的键数 */
function sessionStageCount(session: { stage_ids?: unknown; status?: Record<string, unknown> }): number {
  if (Array.isArray(session?.stage_ids) && session.stage_ids.length > 0) return session.stage_ids.length;
  return Math.max(1, Object.keys(session?.status || {}).length);
}

function projectTaskFromSession(session: any, names: StageNameMap): RunningTaskItem | null {
  const statusMap = session.status || {};
  const values = Object.values(statusMap);
  if (!values.includes('running')) return null;
  const completed = values.filter(value => ['completed', 'session_completed'].includes(String(value))).length;
  const runningStage = Object.keys(statusMap).find(key => statusMap[key] === 'running');
  return {
    id: `project-${session.id}`,
    href: `/?session=${encodeURIComponent(session.id)}`,
    title: session.title || session.idea || session.id,
    scope: runningStage ? `正在生成 · ${stageLabel(runningStage, session, names)}` : '正在生成',
    status: 'running',
    progress: Math.round((completed / sessionStageCount(session)) * 100),
  };
}

function projectReviewTaskFromSession(session: any, names: StageNameMap): RunningTaskItem | null {
  const review = sessionReviewState(session);
  if (!review) return null;
  const completed = Object.values(session.status || {}).filter(value => ['completed', 'session_completed'].includes(String(value))).length;
  const waiting = review.kind === 'waiting';
  return {
    id: `project-review-${session.id}-${waiting ? review.stage : 'completed'}`,
    href: `/?session=${encodeURIComponent(session.id)}${review.stage ? `&stage=${encodeURIComponent(review.stage)}` : ''}`,
    title: session.title || session.idea || session.id,
    scope: waiting ? `待确认 · ${stageLabel(review.stage, session, names)}` : '全部完成',
    status: waiting ? 'waiting' : 'completed',
    progress: waiting ? Math.round((completed / sessionStageCount(session)) * 100) : 100,
  };
}

function pipelineTaskItem(task: PipelineTask): RunningTaskItem | null {
  const route = PIPELINE_ROUTES[task.pipeline];
  if (!route || !['pending', 'running'].includes(task.status)) return null;
  return {
    id: `pipeline-${task.task_id}`,
    href: `${route.href}?task=${encodeURIComponent(task.task_id)}`,
    title: String(taskTitle(task)),
    scope: route.label,
    status: task.status,
    progress: task.progress || 0,
  };
}

function pipelineCompletedTaskItem(task: PipelineTask): RunningTaskItem | null {
  const route = PIPELINE_ROUTES[task.pipeline];
  if (!route || task.status !== 'completed') return null;
  return {
    id: `pipeline-completed-${task.task_id}`,
    href: `${route.href}?task=${encodeURIComponent(task.task_id)}`,
    title: String(taskTitle(task)),
    scope: route.label,
    status: 'completed',
    progress: 100,
  };
}

const SANDBOX_TOOL_LABELS: Record<string, string> = {
  llm: 'AI 对话',
  vlm: '图片理解',
  t2i: '文生图',
  i2i: '图生图',
  video: '视频生成',
};

function sandboxTaskItem(task: SandboxTask): RunningTaskItem {
  const input = task.input || {};
  return {
    id: `sandbox-${task.id}`,
    href: `/sandbox?task=${encodeURIComponent(task.id)}`,
    title: input.prompt || input.reference_image || task.id,
    scope: `AI 工具箱 · ${SANDBOX_TOOL_LABELS[task.tool] || task.tool}`,
    status: task.status || 'running',
    progress: task.progress || 1,
  };
}

function loadDismissedCompletedTasks(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(COMPLETED_TASK_DISMISS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveDismissedCompletedTasks(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(COMPLETED_TASK_DISMISS_KEY, JSON.stringify(Array.from(ids)));
}

function TaskPanel({
  title,
  icon,
  loading,
  tasks,
  currentPath,
  emptyText,
  onTaskClick,
}: {
  title: string;
  icon: React.ReactNode;
  loading?: boolean;
  tasks: RunningTaskItem[];
  currentPath: string;
  emptyText: string;
  onTaskClick: (task: RunningTaskItem) => void;
}) {
  return (
    <section className={clsx('sfa-task-panel border-t border-gray-100 p-3', tasks.length ? 'sfa-task-panel-filled h-[20vh] min-h-32' : 'sfa-task-panel-empty')}>
      <div className="mb-2 flex items-center gap-2 px-1">
        {icon}
        <span className="text-xs font-medium text-gray-500">{title}</span>
        {loading && <Loader2 className="ml-auto h-3 w-3 animate-spin text-gray-300" />}
      </div>
      <div className={clsx('overflow-y-auto pr-1', tasks.length && 'h-[calc(100%-26px)]')}>
        {tasks.length ? (
          <div className="space-y-1.5">
            {tasks.map(task => {
              const active = currentPath === task.href.split('?')[0];
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onTaskClick(task)}
                  className={clsx(
                    'sfa-task-item w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
                    active ? 'border-cream/10 bg-cream/3' : 'border-gray-100 bg-white hover:border-cream/15 hover:bg-cream/2'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700">
                      {task.title.slice(0, 36)}
                    </span>
                    <span className={clsx('flex-shrink-0 rounded px-1.5 py-0.5 text-[10px]', TASK_STATUS_STYLE[task.status] || TASK_STATUS_STYLE.pending)}>
                      {statusText(task.status)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="truncate text-[10px] text-gray-400">{task.scope}</span>
                    <div className="h-1 min-w-10 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-neutral-900" style={{ width: `${task.progress || 0}%` }} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="sfa-task-empty px-1 text-xs text-gray-300">
            {emptyText}
          </div>
        )}
      </div>
    </section>
  );
}

function SidebarTaskPanels({ currentPath, onCountChange }: { currentPath: string; onCountChange?: (count: number) => void }) {
  const router = useRouter();
  const [runningTasks, setRunningTasks] = useState<RunningTaskItem[]>([]);
  const [completedTasks, setCompletedTasks] = useState<RunningTaskItem[]>([]);
  const [dismissedCompleted, setDismissedCompleted] = useState<Set<string>>(() => loadDismissedCompletedTasks());
  const [loading, setLoading] = useState(false);
  const [stageNames, setStageNames] = useState<StageNameMap>({});

  useEffect(() => {
    fetchScenarios()
      .then(list => {
        const map: StageNameMap = {};
        list.scenarios.forEach((scenario: any) => (scenario.stages || []).forEach((stage: any) => {
          map[`${scenario.id}:${stage.id}`] = stage.short_name || stage.name;
          if (!map[stage.id]) map[stage.id] = stage.short_name || stage.name;
        }));
        setStageNames(map);
      })
      .catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [pipelineRecords, sessions, sandboxRecords] = await Promise.all([
        fetchPipelineTasks(100).catch(() => []),
        fetchSessions().catch(() => []),
        fetchSandboxTasks().catch(() => []),
      ]);
      setRunningTasks([
        ...sandboxRecords.map(sandboxTaskItem),
        ...pipelineRecords.map(pipelineTaskItem).filter((task): task is RunningTaskItem => Boolean(task)),
        ...sessions.map(session => projectTaskFromSession(session, stageNames)).filter((task): task is RunningTaskItem => Boolean(task)),
      ]);
      setCompletedTasks([
        ...pipelineRecords.map(pipelineCompletedTaskItem).filter((task): task is RunningTaskItem => Boolean(task)),
        ...sessions.map(session => projectReviewTaskFromSession(session, stageNames)).filter((task): task is RunningTaskItem => Boolean(task)),
      ].filter(task => task.status === 'waiting' || !dismissedCompleted.has(task.id)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    onCountChange?.(runningTasks.length + completedTasks.filter(task => task.status === 'waiting').length);
  }, [runningTasks, completedTasks, onCountChange]);

  useEffect(() => {
    load().catch(() => {});
    const timer = window.setInterval(() => load().catch(() => {}), 3000);
    return () => window.clearInterval(timer);
  }, [dismissedCompleted, stageNames]);

  const handleRunningClick = (task: RunningTaskItem) => {
    router.push(task.href);
  };

  const handleCompletedClick = (task: RunningTaskItem) => {
    if (task.status === 'waiting') {
      router.push(task.href);
      return;
    }
    const next = new Set(dismissedCompleted);
    next.add(task.id);
    saveDismissedCompletedTasks(next);
    setDismissedCompleted(next);
    setCompletedTasks(current => current.filter(item => item.id !== task.id));
    router.push(task.href);
  };

  return (
    <>
      <TaskPanel
        title="进行中任务"
        icon={<Clock className="h-3.5 w-3.5 text-gray-400" />}
        loading={loading}
        tasks={runningTasks}
        currentPath={currentPath}
        emptyText="暂无"
        onTaskClick={handleRunningClick}
      />
      <TaskPanel
        title="待你确认 / 刚完成"
        icon={<CheckCircle2 className="h-3.5 w-3.5 text-gray-400" />}
        tasks={completedTasks}
        currentPath={currentPath}
        emptyText="暂无。全部项目在「作品」"
        onTaskClick={handleCompletedClick}
      />
    </>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState<null | 'tools' | 'tasks' | 'settings'>(null);
  const [taskCount, setTaskCount] = useState(0);
  const [clearingCache, setClearingCache] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isCanvas = pathname.startsWith('/canvas');

  useEffect(() => { setMenu(null); }, [pathname]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      const result = await clearTempCache();
      window.alert(`缓存已清空，删除 ${result.deleted} 项，释放 ${Number(result.freed_mb || 0).toFixed(2)} MB。`);
      setMenu(null);
    } catch (error: any) {
      window.alert(error?.message || '清空缓存失败');
    } finally {
      setClearingCache(false);
    }
  };

  const toolActive = TOOL_ITEMS.some(item => pathname.startsWith(item.href));
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div className="sfa-shell min-h-screen bg-gray-50 text-gray-800" style={{ '--app-sidebar-width': '0px' } as CSSProperties}>
      <nav className="sfa-topnav" ref={menuRef}>
        <Link href="/" className="sfa-topnav-brand">
          <span className="sfa-topnav-logo">{brand.name.slice(0, 1)}</span>
          <span className="sfa-topnav-name">{brand.name}</span>
        </Link>

        <div className="sfa-topnav-main">
          {MAIN_NAV.map(item => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={clsx('sfa-topnav-link', isActive(item.href) && 'is-active')}>
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <div className="relative">
            <button type="button" onClick={() => setMenu(menu === 'tools' ? null : 'tools')} className={clsx('sfa-topnav-link', (toolActive || menu === 'tools') && 'is-active')}>
              <Wrench className="h-4 w-4" />
              <span>工具</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {menu === 'tools' && (
              <div className="sfa-topnav-menu left-0 w-72">
                {TOOL_ITEMS.map(item => {
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href} className={clsx('sfa-topnav-menu-item', pathname.startsWith(item.href) && 'is-active')}>
                      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm">{item.label}</span>
                        <span className="block text-xs text-gray-400">{item.desc}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="sfa-topnav-actions">
          <div className="relative">
            <button type="button" onClick={() => setMenu(menu === 'tasks' ? null : 'tasks')} className={clsx('sfa-topnav-icon', menu === 'tasks' && 'is-active')} title="任务" aria-label="任务">
              <ListChecks className="h-4 w-4" />
              <span className="hidden sm:inline">任务</span>
              {taskCount > 0 && <span className="sfa-topnav-badge">{taskCount}</span>}
            </button>
            <div className={clsx('sfa-topnav-menu right-0 w-80 !p-0', menu !== 'tasks' && 'hidden')}>
              <SidebarTaskPanels currentPath={pathname} onCountChange={setTaskCount} />
            </div>
          </div>
          <div className="relative">
            <button type="button" onClick={() => setMenu(menu === 'settings' ? null : 'settings')} className={clsx('sfa-topnav-icon', (menu === 'settings' || pathname.startsWith(SETTINGS_ITEM.href)) && 'is-active')} title="设置" aria-label="设置">
              <Settings className="h-4 w-4" />
            </button>
            {menu === 'settings' && (
              <div className="sfa-topnav-menu right-0 w-44">
                <button type="button" onClick={() => router.push(SETTINGS_ITEM.href)} className="sfa-topnav-menu-item">
                  <Settings className="h-4 w-4" />
                  修改配置
                </button>
                <button type="button" onClick={() => handleClearCache()} disabled={clearingCache} className="sfa-topnav-menu-item disabled:opacity-60">
                  {clearingCache ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  清空缓存
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className={clsx('sfa-main min-w-0 overflow-x-hidden', isCanvas && 'sfa-main-canvas')}>
        {children}
      </main>
    </div>
  );
}
