/** 从后端会话列表数据推导项目状态（侧栏、我的作品页共用） */

export type StageNameMap = Record<string, string>;

const DONE = ['completed', 'session_completed'];

function stageOrder(session: any): string[] {
  if (Array.isArray(session?.stage_ids) && session.stage_ids.length) return session.stage_ids;
  return Object.keys(session?.status || {}).filter(key => key !== 'completed');
}

export function stageLabel(stageId: string, session: any, names: StageNameMap): string {
  const scenario = session?.scenario || session?.meta?.scenario;
  return names[`${scenario}:${stageId}`] || names[stageId] || stageId;
}

export type ProjectState =
  | { kind: 'running'; stage: string }
  | { kind: 'waiting'; stage: string }
  | { kind: 'done'; stage: string }
  | { kind: 'failed'; stage: string }
  | { kind: 'new'; stage: string };

/**
 * 项目当前状态：
 * - running：有阶段在生成
 * - waiting：有阶段等待确认，或某阶段已完成但下一阶段还没开始（暂停在中间）
 * - done：所有阶段完成
 */
export function projectState(session: any): ProjectState {
  const statusMap: Record<string, string> = session?.status || {};
  const order = stageOrder(session);
  const running = order.find(id => statusMap[id] === 'running');
  if (running) return { kind: 'running', stage: running };
  const failed = order.find(id => ['error', 'failed'].includes(statusMap[id]));
  if (failed) return { kind: 'failed', stage: failed };
  const waiting = order.find(id => statusMap[id] === 'waiting');
  if (waiting) return { kind: 'waiting', stage: waiting };
  const doneCount = order.filter(id => DONE.includes(statusMap[id])).length;
  if (order.length && doneCount >= order.length) return { kind: 'done', stage: order[order.length - 1] };
  if (statusMap.completed === 'completed') return { kind: 'done', stage: order[order.length - 1] || '' };
  const lastDone = [...order].reverse().find(id => DONE.includes(statusMap[id]));
  if (lastDone) return { kind: 'waiting', stage: lastDone };
  return { kind: 'new', stage: order[0] || '' };
}

export function sessionReviewState(session: any): { kind: 'waiting' | 'done'; stage: string } | null {
  const state = projectState(session);
  if (state.kind === 'waiting' || state.kind === 'done') return state;
  return null;
}

export function doneStageCount(session: any): number {
  const statusMap: Record<string, string> = session?.status || {};
  return stageOrder(session).filter(id => DONE.includes(statusMap[id])).length;
}

export function totalStageCount(session: any): number {
  return Math.max(1, stageOrder(session).length);
}
