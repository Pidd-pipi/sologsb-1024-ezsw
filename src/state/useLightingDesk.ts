import { useReducer } from 'react';
import { recalculatePlans, samplePlans } from '../data';
import type { Cue, EditorState, LightingPlan, MergeChoice, MergeSession, Scene, UserRole, Workspace } from '../types';

export const LIGHTING_STORAGE_KEY = 'sologsb-1024/lighting-cue-desk/v1';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createInitialWorkspace(): Workspace {
  const plans = recalculatePlans(clone(samplePlans));
  return {
    plans,
    activePlanId: plans[0].id,
    comparePlanId: plans[1].id,
    selectedSceneId: plans[0].scenes[0].id,
    selectedCueId: plans[0].scenes[0].cues[0].id,
    role: 'designer',
    mergeSessions: []
  };
}

export function createInitialState(): EditorState {
  return {
    workspace: createInitialWorkspace(),
    past: [],
    future: [],
    lastAction: '已载入示例灯光方案'
  };
}

export type EditorAction =
  | { type: 'hydrate'; workspace: Workspace }
  | { type: 'commit'; label: string; mutate: (workspace: Workspace) => void }
  | { type: 'selectScene'; sceneId: string }
  | { type: 'selectCue'; sceneId: string; cueId: string }
  | { type: 'selectPlan'; planId: string }
  | { type: 'comparePlan'; planId: string }
  | { type: 'setRole'; role: UserRole }
  | { type: 'merge/create'; session: MergeSession }
  | { type: 'merge/field'; sessionId: string; blockId: string; entryKey: string; fieldId: string; choice: MergeChoice }
  | { type: 'merge/freeze'; sessionId: string; blockId: string; choice: MergeChoice }
  | { type: 'merge/finish'; sessionId: string; plan: LightingPlan; warnings: string[] }
  | { type: 'merge/remove'; sessionId: string }
  | { type: 'undo' }
  | { type: 'redo' };

function withMergeSession(workspace: Workspace, sessionId: string, update: (session: MergeSession) => MergeSession) {
  workspace.mergeSessions = workspace.mergeSessions.map((session) =>
    session.id === sessionId ? update(session) : session
  );
}

function normalizeWorkspace(workspace: Workspace) {
  recalculatePlans(workspace.plans);
  if (!Array.isArray(workspace.mergeSessions)) workspace.mergeSessions = [];
  const active = workspace.plans.find((plan) => plan.id === workspace.activePlanId) ?? workspace.plans[0];
  if (!active) return workspace;
  workspace.activePlanId = active.id;
  workspace.comparePlanId =
    workspace.plans.find((plan) => plan.id === workspace.comparePlanId && plan.id !== active.id)?.id ??
    workspace.plans.find((plan) => plan.id !== active.id)?.id ??
    active.id;
  const scene = active.scenes.find((item) => item.id === workspace.selectedSceneId) ?? active.scenes[0];
  workspace.selectedSceneId = scene?.id ?? '';
  workspace.selectedCueId = scene?.cues.some((cue) => cue.id === workspace.selectedCueId)
    ? workspace.selectedCueId
    : scene?.cues[0]?.id ?? '';
  return workspace;
}

export function lightingReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'hydrate':
      return {
        workspace: normalizeWorkspace(clone(action.workspace)),
        past: [],
        future: [],
        lastAction: '已恢复离线灯光草稿'
      };
    case 'commit': {
      const next = clone(state.workspace);
      action.mutate(next);
      normalizeWorkspace(next);
      const active = next.plans.find((plan) => plan.id === next.activePlanId);
      if (active) active.updatedAt = new Date().toISOString();
      return {
        workspace: next,
        past: [...state.past.slice(-49), clone(state.workspace)],
        future: [],
        lastAction: action.label
      };
    }
    case 'selectScene': {
      const active = state.workspace.plans.find((plan) => plan.id === state.workspace.activePlanId);
      const scene = active?.scenes.find((item) => item.id === action.sceneId);
      return {
        ...state,
        workspace: {
          ...state.workspace,
          selectedSceneId: action.sceneId,
          selectedCueId: scene?.cues[0]?.id ?? ''
        }
      };
    }
    case 'selectCue':
      return {
        ...state,
        workspace: {
          ...state.workspace,
          selectedSceneId: action.sceneId,
          selectedCueId: action.cueId
        }
      };
    case 'selectPlan': {
      const plan = state.workspace.plans.find((item) => item.id === action.planId);
      return {
        ...state,
        workspace: {
          ...state.workspace,
          activePlanId: action.planId,
          comparePlanId:
            action.planId === state.workspace.comparePlanId
              ? state.workspace.plans.find((item) => item.id !== action.planId)?.id ?? action.planId
              : state.workspace.comparePlanId,
          selectedSceneId: plan?.scenes[0]?.id ?? '',
          selectedCueId: plan?.scenes[0]?.cues[0]?.id ?? ''
        }
      };
    }
    case 'comparePlan':
      return { ...state, workspace: { ...state.workspace, comparePlanId: action.planId } };
    case 'setRole':
      return { ...state, workspace: { ...state.workspace, role: action.role } };
    case 'merge/create': {
      const next = clone(state.workspace);
      next.mergeSessions = [action.session, ...next.mergeSessions];
      return {
        workspace: next,
        past: [...state.past.slice(-49), clone(state.workspace)],
        future: [],
        lastAction: '已导入两份离线草稿并建立合并任务'
      };
    }
    case 'merge/field': {
      const next = clone(state.workspace);
      withMergeSession(next, action.sessionId, (session) => {
        for (const block of session.blocks) {
          if (block.id !== action.blockId) continue;
          for (const entry of block.entries) {
            if (entry.key !== action.entryKey) continue;
            for (const field of entry.fields) {
              if (field.id === action.fieldId) {
                field.choice = action.choice;
                field.auto = false;
              }
            }
            entry.status = entry.fields.some((item) => item.choice === null)
              ? 'pending'
              : entry.fields.some((item) => item.auto)
                ? 'auto'
                : 'resolved';
          }
        }
        session.updatedAt = new Date().toISOString();
        return session;
      });
      return {
        workspace: next,
        past: [...state.past.slice(-49), clone(state.workspace)],
        future: [],
        lastAction: '已记录操作人的候选选择'
      };
    }
    case 'merge/freeze': {
      const next = clone(state.workspace);
      withMergeSession(next, action.sessionId, (session) => {
        const block = session.blocks.find((item) => item.id === action.blockId);
        if (block) {
          block.freezeChoice = action.choice;
          block.freezeAuto = false;
          block.freezeNote =
            action.choice === 'base'
              ? `已按操作人决定保留原冻结状态（${block.freezeBase ? '已冻结' : '未冻结'}），编程执行的越权改动被挡下。`
              : '已按操作人决定采用该冻结候选。';
          session.updatedAt = new Date().toISOString();
        }
        return session;
      });
      return {
        workspace: next,
        past: [...state.past.slice(-49), clone(state.workspace)],
        future: [],
        lastAction: '已处理冻结状态决定'
      };
    }
    case 'merge/finish': {
      const next = clone(state.workspace);
      next.plans.push(action.plan);
      next.activePlanId = action.plan.id;
      next.comparePlanId = state.workspace.activePlanId;
      const firstScene = action.plan.scenes.find((scene) => scene.order === 1) ?? action.plan.scenes[0];
      next.selectedSceneId = firstScene?.id ?? '';
      next.selectedCueId = firstScene?.cues[0]?.id ?? '';
      withMergeSession(next, action.sessionId, (session) => ({
        ...session,
        status: 'completed',
        resultPlanId: action.plan.id,
        resultPlanName: action.plan.name,
        warnings: action.warnings,
        updatedAt: new Date().toISOString()
      }));
      return {
        workspace: next,
        past: [...state.past.slice(-49), clone(state.workspace)],
        future: [],
        lastAction: '已生成合并方案并重算全剧时间与冲突'
      };
    }
    case 'merge/remove': {
      const next = clone(state.workspace);
      next.mergeSessions = next.mergeSessions.filter((session) => session.id !== action.sessionId);
      return {
        workspace: next,
        past: [...state.past.slice(-49), clone(state.workspace)],
        future: [],
        lastAction: '已移除合并任务'
      };
    }
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        workspace: clone(previous),
        past: state.past.slice(0, -1),
        future: [clone(state.workspace), ...state.future].slice(0, 50),
        lastAction: '已撤销上一步操作'
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        workspace: clone(next),
        past: [...state.past, clone(state.workspace)].slice(-50),
        future: state.future.slice(1),
        lastAction: '已重做上一步操作'
      };
    }
    default:
      return state;
  }
}

export function useLightingDesk() {
  return useReducer(lightingReducer, undefined, createInitialState);
}

export function findActivePlan(workspace: Workspace): LightingPlan {
  return workspace.plans.find((plan) => plan.id === workspace.activePlanId) ?? workspace.plans[0];
}

export function findActiveScene(workspace: Workspace): Scene | undefined {
  return findActivePlan(workspace)?.scenes.find((scene) => scene.id === workspace.selectedSceneId);
}

export function findActiveCue(workspace: Workspace): Cue | undefined {
  return findActiveScene(workspace)?.cues.find((cue) => cue.id === workspace.selectedCueId);
}

export function canEditScene(role: UserRole, scene: Scene | undefined) {
  return Boolean(scene && !scene.frozen && role !== 'readonly' && role !== 'stage-manager');
}

export function canFreeze(role: UserRole) {
  return role === 'designer' || role === 'stage-manager';
}

export function formatTime(value: number | undefined) {
  const safe = Math.max(0, value ?? 0);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${tenths}`;
}
