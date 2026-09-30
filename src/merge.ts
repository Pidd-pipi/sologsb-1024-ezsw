import { recalculatePlans } from './data';
import type { Cue, LightingPlan, Scene, UserRole } from './types';

export const MERGE_STORAGE_KEY = 'sologsb-1024/merge-tasks/v1';

export type MergeDraftId = 'A' | 'B';

export type MergeField = 'channel' | 'brightness' | 'fadeIn' | 'hold' | 'fadeOut' | 'followCueId';

export interface MergeCandidate {
  draftId: MergeDraftId;
  value: string | number;
}

export interface MergeConflict {
  id: string;
  sceneOrder: number;
  sceneName: string;
  cueNumber: string;
  cueLabel: string;
  field: MergeField;
  original: string | number;
  candidates: MergeCandidate[];
  chosen: 'original' | MergeDraftId;
}

export interface MergeBlocked {
  id: string;
  draftId: MergeDraftId;
  kind: 'frozen-flag' | 'frozen-cue-edit';
  sceneOrder: number;
  sceneName: string;
  cueNumber?: string;
  cueLabel?: string;
  message: string;
}

export interface MergeAddedCue {
  id: string;
  draftId: MergeDraftId;
  sceneOrder: number;
  sceneName: string;
  cueNumber: string;
  cueLabel: string;
}

export interface MergeAutoChange {
  id: string;
  sceneOrder: number;
  cueNumber: string;
  field: MergeField;
  value: string | number;
  reason: 'agreed' | 'single-A' | 'single-B';
}

export interface MergeTask {
  id: string;
  createdAt: string;
  updatedAt: string;
  basePlanId: string;
  basePlanName: string;
  draftALabel: string;
  draftBLabel: string;
  draftARole?: UserRole;
  draftBRole?: UserRole;
  status: 'in-progress' | 'completed';
  basePlan: LightingPlan;
  draftA: LightingPlan;
  draftB: LightingPlan;
  conflicts: MergeConflict[];
  blocked: MergeBlocked[];
  addedCues: MergeAddedCue[];
  autoChanges: MergeAutoChange[];
  mergedPlanId?: string;
  mergedPlanName?: string;
  completedAt?: string;
}

export const MERGE_FIELDS: { key: MergeField; label: string }[] = [
  { key: 'channel', label: '通道' },
  { key: 'brightness', label: '亮度' },
  { key: 'fadeIn', label: '渐入' },
  { key: 'hold', label: '保持' },
  { key: 'fadeOut', label: '渐出' },
  { key: 'followCueId', label: '跟随目标' }
];

export function fieldLabel(key: MergeField): string {
  return MERGE_FIELDS.find((item) => item.key === key)?.label ?? key;
}

export function formatFieldValue(field: MergeField, value: string | number | undefined, plan: LightingPlan): string {
  if (value === undefined || value === '') return '—';
  if (field === 'followCueId') {
    for (const scene of plan.scenes) {
      const cue = scene.cues.find((item) => item.id === value);
      if (cue) return `${cue.number} · ${cue.label}`;
    }
    return String(value);
  }
  if (field === 'brightness') return `${value}%`;
  if (field === 'fadeIn' || field === 'hold' || field === 'fadeOut') return `${value}s`;
  return String(value);
}

function findMatchingCue(baseCue: Cue, draftScene: Scene): Cue | undefined {
  let found = draftScene.cues.find((candidate) => candidate.number === baseCue.number);
  if (found) return found;
  if (baseCue.position.trim()) {
    found = draftScene.cues.find((candidate) => candidate.position === baseCue.position);
    if (found) return found;
  }
  return undefined;
}

function cueChanged(a: Cue, b: Cue): boolean {
  return (
    a.number !== b.number ||
    a.label !== b.label ||
    a.position !== b.position ||
    a.channel !== b.channel ||
    a.color !== b.color ||
    a.colorHex !== b.colorHex ||
    a.brightness !== b.brightness ||
    a.fadeIn !== b.fadeIn ||
    a.hold !== b.hold ||
    a.fadeOut !== b.fadeOut ||
    a.followCueId !== b.followCueId ||
    a.targetNote !== b.targetNote ||
    a.notes !== b.notes ||
    a.status !== b.status
  );
}

export function analyzeMerge(
  base: LightingPlan,
  draftA: LightingPlan,
  draftB: LightingPlan,
  roles: { A?: UserRole; B?: UserRole }
): { conflicts: MergeConflict[]; blocked: MergeBlocked[]; addedCues: MergeAddedCue[]; autoChanges: MergeAutoChange[] } {
  const conflicts: MergeConflict[] = [];
  const blocked: MergeBlocked[] = [];
  const addedCues: MergeAddedCue[] = [];
  const autoChanges: MergeAutoChange[] = [];
  const blockedDraftCues = new Set<string>();

  const isProgrammerA = roles.A === 'programmer';
  const isProgrammerB = roles.B === 'programmer';

  const orders = new Set<number>();
  base.scenes.forEach((scene) => orders.add(scene.order));
  draftA.scenes.forEach((scene) => orders.add(scene.order));
  draftB.scenes.forEach((scene) => orders.add(scene.order));

  for (const order of [...orders].sort((a, b) => a - b)) {
    const baseScene = base.scenes.find((scene) => scene.order === order);
    const aScene = draftA.scenes.find((scene) => scene.order === order);
    const bScene = draftB.scenes.find((scene) => scene.order === order);
    const sceneName = baseScene?.name ?? aScene?.name ?? bScene?.name ?? `场次 ${order}`;

    if (baseScene) {
      if (aScene && isProgrammerA && aScene.frozen !== baseScene.frozen) {
        blocked.push({
          id: `block-A-${order}-frozen`,
          draftId: 'A',
          kind: 'frozen-flag',
          sceneOrder: order,
          sceneName,
          message: `草稿甲（编程执行）改动了场次「${sceneName}」的冻结状态，已越权拦截`
        });
      }
      if (bScene && isProgrammerB && bScene.frozen !== baseScene.frozen) {
        blocked.push({
          id: `block-B-${order}-frozen`,
          draftId: 'B',
          kind: 'frozen-flag',
          sceneOrder: order,
          sceneName,
          message: `草稿乙（编程执行）改动了场次「${sceneName}」的冻结状态，已越权拦截`
        });
      }
    }

    if (!baseScene) {
      if (aScene) {
        aScene.cues.forEach((cue) =>
          addedCues.push({
            id: `add-A-${order}-${cue.id}`,
            draftId: 'A',
            sceneOrder: order,
            sceneName,
            cueNumber: cue.number,
            cueLabel: cue.label
          })
        );
      }
      if (bScene) {
        bScene.cues.forEach((cue) =>
          addedCues.push({
            id: `add-B-${order}-${cue.id}`,
            draftId: 'B',
            sceneOrder: order,
            sceneName,
            cueNumber: cue.number,
            cueLabel: cue.label
          })
        );
      }
      continue;
    }

    const aMatchedIds = new Set<string>();
    const bMatchedIds = new Set<string>();

    for (const baseCue of baseScene.cues) {
      const aCue = aScene ? findMatchingCue(baseCue, aScene) : undefined;
      const bCue = bScene ? findMatchingCue(baseCue, bScene) : undefined;
      if (aCue) aMatchedIds.add(aCue.id);
      if (bCue) bMatchedIds.add(bCue.id);

      if (baseScene.frozen) {
        if (isProgrammerA && aCue && cueChanged(baseCue, aCue)) {
          blocked.push({
            id: `block-A-${order}-${baseCue.id}`,
            draftId: 'A',
            kind: 'frozen-cue-edit',
            sceneOrder: order,
            sceneName,
            cueNumber: baseCue.number,
            cueLabel: baseCue.label,
            message: `草稿甲（编程执行）修改了冻结场次「${sceneName}」的提示 ${baseCue.number}，已越权拦截`
          });
          blockedDraftCues.add(`A:${order}:${baseCue.number}`);
        }
        if (isProgrammerB && bCue && cueChanged(baseCue, bCue)) {
          blocked.push({
            id: `block-B-${order}-${baseCue.id}`,
            draftId: 'B',
            kind: 'frozen-cue-edit',
            sceneOrder: order,
            sceneName,
            cueNumber: baseCue.number,
            cueLabel: baseCue.label,
            message: `草稿乙（编程执行）修改了冻结场次「${sceneName}」的提示 ${baseCue.number}，已越权拦截`
          });
          blockedDraftCues.add(`B:${order}:${baseCue.number}`);
        }
      }

      const isABlocked = blockedDraftCues.has(`A:${order}:${baseCue.number}`);
      const isBBlocked = blockedDraftCues.has(`B:${order}:${baseCue.number}`);

      for (const { key } of MERGE_FIELDS) {
        const v0 = baseCue[key] as string | number;
        const va = aCue ? (aCue[key] as string | number) : undefined;
        const vb = bCue ? (bCue[key] as string | number) : undefined;
        const aChanged = va !== undefined && va !== v0;
        const bChanged = vb !== undefined && vb !== v0;

        if (aChanged && bChanged) {
          if (va === vb) {
            if (isABlocked && isBBlocked) continue;
            autoChanges.push({
              id: `auto-${order}-${baseCue.id}-${key}`,
              sceneOrder: order,
              cueNumber: baseCue.number,
              field: key,
              value: va,
              reason: 'agreed'
            });
          } else {
            const validCandidates: MergeCandidate[] = [];
            if (!isABlocked) validCandidates.push({ draftId: 'A', value: va });
            if (!isBBlocked) validCandidates.push({ draftId: 'B', value: vb });
            if (validCandidates.length === 0) continue;
            if (validCandidates.length === 1) {
              autoChanges.push({
                id: `auto-${order}-${baseCue.id}-${key}`,
                sceneOrder: order,
                cueNumber: baseCue.number,
                field: key,
                value: validCandidates[0].value,
                reason: validCandidates[0].draftId === 'A' ? 'single-A' : 'single-B'
              });
            } else {
              conflicts.push({
                id: `conflict-${order}-${baseCue.id}-${key}`,
                sceneOrder: order,
                sceneName,
                cueNumber: baseCue.number,
                cueLabel: baseCue.label,
                field: key,
                original: v0,
                candidates: validCandidates,
                chosen: 'original'
              });
            }
          }
        } else if (aChanged) {
          if (isABlocked) continue;
          autoChanges.push({
            id: `auto-${order}-${baseCue.id}-${key}`,
            sceneOrder: order,
            cueNumber: baseCue.number,
            field: key,
            value: va,
            reason: 'single-A'
          });
        } else if (bChanged) {
          if (isBBlocked) continue;
          autoChanges.push({
            id: `auto-${order}-${baseCue.id}-${key}`,
            sceneOrder: order,
            cueNumber: baseCue.number,
            field: key,
            value: vb,
            reason: 'single-B'
          });
        }
      }
    }

    if (aScene) {
      for (const cue of aScene.cues) {
        if (!aMatchedIds.has(cue.id)) {
          addedCues.push({
            id: `add-A-${order}-${cue.id}`,
            draftId: 'A',
            sceneOrder: order,
            sceneName,
            cueNumber: cue.number,
            cueLabel: cue.label
          });
        }
      }
    }
    if (bScene) {
      for (const cue of bScene.cues) {
        if (!bMatchedIds.has(cue.id)) {
          addedCues.push({
            id: `add-B-${order}-${cue.id}`,
            draftId: 'B',
            sceneOrder: order,
            sceneName,
            cueNumber: cue.number,
            cueLabel: cue.label
          });
        }
      }
    }
  }

  return { conflicts, blocked, addedCues, autoChanges };
}

export function generateMergedPlan(task: MergeTask): LightingPlan {
  const merged = structuredClone(task.basePlan);
  merged.id = `plan-merge-${task.id}`;
  merged.name = `${task.basePlanName} · 合并稿`;
  merged.description = '由两份离线草稿合并生成，保留原值与双方候选，越权内容已拦截。';
  merged.updatedAt = new Date().toISOString();

  for (const change of task.autoChanges) {
    const scene = merged.scenes.find((item) => item.order === change.sceneOrder);
    const cue = scene?.cues.find((item) => item.number === change.cueNumber);
    if (cue) (cue as unknown as Record<string, string | number>)[change.field] = change.value;
  }

  for (const conflict of task.conflicts) {
    const scene = merged.scenes.find((item) => item.order === conflict.sceneOrder);
    const cue = scene?.cues.find((item) => item.number === conflict.cueNumber);
    if (!cue) continue;
    if (conflict.chosen === 'A') {
      const candidate = conflict.candidates.find((item) => item.draftId === 'A');
      if (candidate) (cue as unknown as Record<string, string | number>)[conflict.field] = candidate.value;
    } else if (conflict.chosen === 'B') {
      const candidate = conflict.candidates.find((item) => item.draftId === 'B');
      if (candidate) (cue as unknown as Record<string, string | number>)[conflict.field] = candidate.value;
    }
  }

  for (const added of task.addedCues) {
    const draft = added.draftId === 'A' ? task.draftA : task.draftB;
    const draftScene = draft.scenes.find((item) => item.order === added.sceneOrder);
    const draftCue = draftScene?.cues.find((item) => item.number === added.cueNumber);
    if (!draftCue) continue;
    let scene = merged.scenes.find((item) => item.order === added.sceneOrder);
    if (!scene) {
      scene = {
        id: `scene-merge-${added.sceneOrder}-${added.draftId}`,
        name: draftScene?.name ?? `场次 ${added.sceneOrder}`,
        order: added.sceneOrder,
        frozen: false,
        cues: []
      };
      merged.scenes.push(scene);
    }
    const newCue = structuredClone(draftCue) as Cue;
    let newId = `cue-merge-${added.draftId}-${added.sceneOrder}-${added.cueNumber}-${Date.now().toString(36)}`;
    while (scene.cues.some((item) => item.id === newId)) newId += '-x';
    newCue.id = newId;
    if (newCue.followCueId) {
      const followedDraft = draftScene?.cues.find((item) => item.id === newCue.followCueId);
      if (followedDraft) {
        const followedInMerged = scene.cues.find((item) => item.number === followedDraft.number);
        newCue.followCueId = followedInMerged ? followedInMerged.id : '';
      } else {
        newCue.followCueId = '';
      }
    }
    scene.cues.push(newCue);
  }

  recalculatePlans([merged]);
  return merged;
}

export function recomputeAnalysis(task: MergeTask): MergeTask {
  const analyzed = analyzeMerge(task.basePlan, task.draftA, task.draftB, {
    A: task.draftARole,
    B: task.draftBRole
  });
  const prevChoices = new Map(task.conflicts.map((item) => [item.id, item.chosen] as const));
  for (const conflict of analyzed.conflicts) {
    const prev = prevChoices.get(conflict.id);
    if (prev) conflict.chosen = prev;
  }
  return { ...task, ...analyzed, updatedAt: new Date().toISOString() };
}

export async function parseDraftFile(file: File): Promise<{ plan: LightingPlan; role?: UserRole; label: string }> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  let plan: LightingPlan;
  let role: UserRole | undefined;
  const candidatePlan = parsed.plan as LightingPlan | undefined;
  if (candidatePlan && Array.isArray(candidatePlan.scenes)) {
    plan = candidatePlan;
    role = parsed.role as UserRole | undefined;
  } else if (Array.isArray((parsed as unknown as LightingPlan).scenes)) {
    plan = parsed as unknown as LightingPlan;
  } else {
    throw new Error('文件格式不正确，缺少方案数据（scenes 字段）');
  }
  return { plan, role, label: file.name.replace(/\.json$/i, '') };
}

export function loadMergeTasks(): MergeTask[] {
  try {
    const raw = localStorage.getItem(MERGE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MergeTask[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMergeTasks(tasks: MergeTask[]) {
  localStorage.setItem(MERGE_STORAGE_KEY, JSON.stringify(tasks));
}

export function upsertMergeTask(task: MergeTask): MergeTask[] {
  const tasks = loadMergeTasks();
  const index = tasks.findIndex((item) => item.id === task.id);
  const updated = { ...task, updatedAt: new Date().toISOString() };
  if (index >= 0) tasks[index] = updated;
  else tasks.push(updated);
  saveMergeTasks(tasks);
  return tasks;
}

export function deleteMergeTask(id: string) {
  saveMergeTasks(loadMergeTasks().filter((item) => item.id !== id));
}
