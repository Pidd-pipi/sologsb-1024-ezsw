import { recalculatePlans, statusLabels } from '../data';
import type {
  Cue,
  DraftBundle,
  DraftRole,
  FieldConflict,
  LightingPlan,
  MergeChoice,
  MergeCueEntry,
  MergeFieldKey,
  MergeSceneBlock,
  MergeSession,
  MergeStats,
  Scene
} from '../types';

export interface FieldMeta {
  key: MergeFieldKey;
  label: string;
  group: 'channel' | 'brightness' | 'fade' | 'follow' | 'other';
}

/** 参与三方合并的字段；通道 / 亮度 / 渐变 / 跟随目标按需求重点处理，其余字段同样留痕 */
export const mergeFields: FieldMeta[] = [
  { key: 'channel', label: '通道', group: 'channel' },
  { key: 'brightness', label: '亮度', group: 'brightness' },
  { key: 'fadeIn', label: '渐入', group: 'fade' },
  { key: 'hold', label: '保持', group: 'fade' },
  { key: 'fadeOut', label: '渐出', group: 'fade' },
  { key: 'followCueId', label: '跟随目标', group: 'follow' },
  { key: 'position', label: '灯位', group: 'other' },
  { key: 'label', label: '提示名称', group: 'other' },
  { key: 'color', label: '颜色', group: 'other' },
  { key: 'colorHex', label: '色值', group: 'other' },
  { key: 'targetNote', label: '触发点', group: 'other' },
  { key: 'notes', label: '备注', group: 'other' },
  { key: 'status', label: '执行状态', group: 'other' }
];

export const keyFields: MergeFieldKey[] = ['channel', 'brightness', 'fadeIn', 'hold', 'fadeOut', 'followCueId'];

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 跟随目标的跨文件语义：统一换算成提示编号；找不到的引用保留 #id 作为失效标记。
 * id 在整个方案内唯一，因此按 id 查到的编号是确定的。
 */
function followTargetNumber(scope: Scene | LightingPlan | undefined, rawId: string): string {
  if (!rawId) return '';
  const scenes = scope && 'scenes' in scope ? scope.scenes : scope ? [scope] : [];
  const target = scenes.flatMap((scene) => scene.cues).find((cue) => cue.id === rawId);
  return target ? target.number : `#${rawId}`;
}

function followLabel(scene: Scene | undefined, rawId: string): string {
  if (!rawId) return '顺序触发';
  const target = scene?.cues.find((cue) => cue.id === rawId);
  if (target) return `${target.number} ${target.label}`;
  // 合并会话中跟随值已归一化为提示编号；# 前缀表示来源方案里找不到的失效引用
  if (rawId.startsWith('#')) return `失效引用（${rawId.slice(1)}）`;
  return `跟随 ${rawId}`;
}

export function formatFieldValue(field: MergeFieldKey, raw: unknown, scene?: Scene): string {
  if (field === 'followCueId') return followLabel(scene, String(raw ?? ''));
  if (field === 'brightness') return `${Number(raw ?? 0)}%`;
  if (field === 'fadeIn' || field === 'hold' || field === 'fadeOut') return `${Number(raw ?? 0)}s`;
  if (field === 'status') return statusLabels[(raw as Cue['status']) ?? 'draft'] ?? String(raw ?? '');
  if (field === 'colorHex') return String(raw ?? '').toUpperCase();
  const text = String(raw ?? '').trim();
  return text ? text : '（空）';
}

export function fieldMeta(field: MergeFieldKey): FieldMeta {
  return mergeFields.find((item) => item.key === field) ?? mergeFields[0];
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ---------------- 离线草稿导入与校验 ---------------- */

export class DraftParseError extends Error {}

/**
 * 接受两种离线草稿文件：
 * 1. 设计台导出的 { plan, role, ... }
 * 2. 直接导出的 LightingPlan（含 scenes/cues）
 */
export function parseDraftFile(rawText: string, fileName: string): DraftBundle {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new DraftParseError('文件不是有效的 JSON，请确认导出的是灯光方案草稿。');
  }
  const planCandidate = (data as { plan?: LightingPlan })?.plan ?? (data as LightingPlan);
  const plan = planCandidate as LightingPlan | undefined;
  if (!plan || !Array.isArray(plan.scenes)) {
    throw new DraftParseError('草稿中缺少 scenes 场次数据，无法对齐。');
  }
  for (const scene of plan.scenes) {
    if (!Array.isArray(scene.cues)) {
      throw new DraftParseError(`场次「${scene.name ?? scene.id}」缺少 cues 提示列表。`);
    }
  }
  const embeddedRole = (data as { role?: DraftRole })?.role;
  const role: DraftRole = embeddedRole === 'designer' || embeddedRole === 'programmer' ? embeddedRole : 'programmer';
  return {
    role,
    owner: role === 'designer' ? '灯光设计离线草稿' : '编程执行离线草稿',
    savedAt: plan.updatedAt ?? new Date().toISOString(),
    fileName,
    plan: structuredClone(plan)
  };
}

export function draftFromPlan(plan: LightingPlan, role: DraftRole, owner: string): DraftBundle {
  return {
    role,
    owner,
    savedAt: plan.updatedAt ?? new Date().toISOString(),
    plan: structuredClone(plan)
  };
}

/* ---------------- 三方合并会话构建 ---------------- */

function buildEntries(baseScene: Scene | undefined, sceneA: Scene | undefined, sceneB: Scene | undefined): MergeCueEntry[] {
  const numbers: string[] = [];
  const pushNumber = (number: string) => {
    if (number && !numbers.includes(number)) numbers.push(number);
  };
  baseScene?.cues.forEach((cue) => pushNumber(cue.number));
  sceneA?.cues.forEach((cue) => pushNumber(cue.number));
  sceneB?.cues.forEach((cue) => pushNumber(cue.number));

  return numbers.map((number) => {
    const baseCue = baseScene?.cues.find((cue) => cue.number === number);
    const cueA = sceneA?.cues.find((cue) => cue.number === number);
    const cueB = sceneB?.cues.find((cue) => cue.number === number);

    const fields: FieldConflict[] = [];
    for (const meta of mergeFields) {
      let baseValue: unknown = baseCue ? baseCue[meta.key] : undefined;
      let valueA: unknown = cueA ? cueA[meta.key] : undefined;
      let valueB: unknown = cueB ? cueB[meta.key] : undefined;

      let targetBase: string | undefined;
      let targetA: string | undefined;
      let targetB: string | undefined;
      if (meta.key === 'followCueId') {
        targetBase = followTargetNumber(baseScene, String(baseValue ?? ''));
        targetA = followTargetNumber(sceneA, String(valueA ?? ''));
        targetB = followTargetNumber(sceneB, String(valueB ?? ''));
        baseValue = targetBase;
        valueA = targetA;
        valueB = targetB;
      }

      const hasBase = Boolean(baseCue);
      const changedA = !hasBase || !sameValue(valueA, baseValue);
      const changedB = !hasBase || !sameValue(valueB, baseValue);

      if (hasBase) {
        if (!changedA && !changedB) continue;
        if (changedA && changedB && sameValue(valueA, valueB)) {
          fields.push({ id: uid('f'), field: meta.key, baseValue, valueA, valueB, targetBase, targetA, targetB, choice: 'a', auto: true });
        } else if (changedA && changedB) {
          fields.push({ id: uid('f'), field: meta.key, baseValue, valueA, valueB, targetBase, targetA, targetB, choice: null, auto: false });
        } else {
          fields.push({ id: uid('f'), field: meta.key, baseValue, valueA, valueB, targetBase, targetA, targetB, choice: changedA ? 'a' : 'b', auto: true });
        }
      } else if (cueA && cueB) {
        // 双方新增的同编号提示：只在两边取值不一致时要求操作人定夺
        if (sameValue(valueA, valueB)) continue;
        fields.push({ id: uid('f'), field: meta.key, baseValue, valueA, valueB, targetBase, targetA, targetB, choice: null, auto: false });
      }
    }

    const status: MergeCueEntry['status'] = fields.some((field) => field.choice === null)
      ? 'pending'
      : fields.length
        ? 'auto'
        : 'resolved';

    return {
      key: number,
      number,
      hasBase: Boolean(baseCue),
      hasA: Boolean(cueA),
      hasB: Boolean(cueB),
      baseCue,
      cueA,
      cueB,
      fields,
      status
    };
  });
}

function describeFreeze(
  base: boolean,
  a: boolean | undefined,
  b: boolean | undefined,
  roleA: DraftRole,
  roleB: DraftRole
): Pick<MergeSceneBlock, 'freezeChoice' | 'freezeAuto' | 'freezeBlocked' | 'freezeNote'> {
  const changedA = a !== undefined && a !== base;
  const changedB = b !== undefined && b !== base;
  const aUnauthorized = changedA && roleA !== 'designer';
  const bUnauthorized = changedB && roleB !== 'designer';

  if (!changedA && !changedB) {
    return { freezeChoice: 'base', freezeAuto: true, freezeBlocked: false, freezeNote: '两份草稿均未改动冻结状态。' };
  }

  // 只要有编程执行越权改动冻结状态：该候选一律挡下，并强制留在待处理清单，
  // 由灯光设计/舞台监督在本机拍板（即使灯光设计提出了相同值，也需要显式确认）。
  if (aUnauthorized || bUnauthorized) {
    const sameTarget = a === b;
    const designerSide = changedA && !aUnauthorized ? 'a' : changedB && !bUnauthorized ? 'b' : null;
    const note = sameTarget && designerSide
      ? '编程执行无权改动冻结状态，其草稿中的越权改动已挡下；灯光设计提出了相同的冻结决定，需操作人显式确认后才会并入。'
      : designerSide
        ? '编程执行的冻结改动已挡下，可在原值与灯光设计候选间选择。'
        : '编程执行无权改动冻结状态，已挡下并留在待处理清单，请灯光设计或舞台监督决定保留原值或给出冻结决定。';
    return { freezeChoice: null, freezeAuto: false, freezeBlocked: true, freezeNote: note };
  }

  // 提出改动的一侧或两侧均为有权限的灯光设计
  if (changedA && changedB) {
    if (a === b) {
      return { freezeChoice: 'a', freezeAuto: true, freezeBlocked: false, freezeNote: '两份灯光设计草稿对冻结状态的改动一致，已自动并入。' };
    }
    return { freezeChoice: null, freezeAuto: false, freezeBlocked: false, freezeNote: '两份草稿对冻结状态的决定不同，请选择。' };
  }
  const designerLabel = changedA ? '草稿 A' : '草稿 B';
  return { freezeChoice: changedA ? 'a' : 'b', freezeAuto: true, freezeBlocked: false, freezeNote: `${designerLabel}（灯光设计）请求调整冻结状态，已自动并入，可改回。` };
}

export function createMergeSession(basePlan: LightingPlan, draftA: DraftBundle, draftB: DraftBundle): MergeSession {
  const orders = Array.from(
    new Set([
      ...basePlan.scenes.map((scene) => scene.order),
      ...draftA.plan.scenes.map((scene) => scene.order),
      ...draftB.plan.scenes.map((scene) => scene.order)
    ])
  ).sort((left, right) => left - right);

  const warnings: string[] = [];
  const blocks: MergeSceneBlock[] = orders.map((order) => {
    const baseScene = basePlan.scenes.find((scene) => scene.order === order);
    const sceneA = draftA.plan.scenes.find((scene) => scene.order === order);
    const sceneB = draftB.plan.scenes.find((scene) => scene.order === order);
    if (!baseScene && (sceneA || sceneB)) {
      warnings.push(`主控方案缺少第 ${order} 场，草稿中的新场次将直接并入。`);
    }
    const freeze = describeFreeze(
      baseScene?.frozen ?? false,
      sceneA?.frozen,
      sceneB?.frozen,
      draftA.role,
      draftB.role
    );
    return {
      id: uid('block'),
      order,
      hasBase: Boolean(baseScene),
      hasA: Boolean(sceneA),
      hasB: Boolean(sceneB),
      baseSceneId: baseScene?.id,
      nameBase: baseScene?.name,
      nameA: sceneA?.name,
      nameB: sceneB?.name,
      freezeBase: baseScene?.frozen ?? false,
      freezeA: sceneA?.frozen,
      freezeB: sceneB?.frozen,
      ...freeze,
      entries: buildEntries(baseScene, sceneA, sceneB)
    };
  });

  const now = new Date().toISOString();
  return {
    id: uid('merge'),
    basePlanId: basePlan.id,
    basePlanName: basePlan.name,
    baseSnapshot: structuredClone(basePlan),
    draftA,
    draftB,
    blocks,
    status: 'open',
    warnings: Array.from(new Set(warnings)),
    createdAt: now,
    updatedAt: now
  };
}

/* ---------------- 统计与选择 ---------------- */

export function sessionStats(session: MergeSession): MergeStats {
  let entries = 0;
  let newCues = 0;
  let autoChanges = 0;
  let pendingFields = 0;
  let pendingEntries = 0;
  let blockedFreezes = 0;
  let pendingFreezes = 0;
  for (const block of session.blocks) {
    if (block.freezeChoice === null) {
      pendingFreezes += 1;
      if (block.freezeBlocked) blockedFreezes += 1;
    }
    for (const entry of block.entries) {
      entries += 1;
      if (!entry.hasBase) newCues += 1;
      let pending = false;
      for (const field of entry.fields) {
        if (field.choice === null) {
          pendingFields += 1;
          pending = true;
        } else if (field.auto) {
          autoChanges += 1;
        }
      }
      if (pending) pendingEntries += 1;
    }
  }
  return {
    scenes: session.blocks.length,
    entries,
    newCues,
    autoChanges,
    pendingFields,
    pendingEntries,
    blockedFreezes,
    pendingFreezes,
    resolved: session.status === 'completed' || (pendingFields === 0 && pendingFreezes === 0)
  };
}

export function entryStatus(entry: MergeCueEntry): MergeCueEntry['status'] {
  if (entry.fields.some((field) => field.choice === null)) return 'pending';
  return entry.fields.some((field) => field.auto) ? 'auto' : 'resolved';
}

export function withFieldChoice(
  session: MergeSession,
  blockId: string,
  entryKey: string,
  fieldId: string,
  choice: MergeChoice
): MergeSession {
  const next = structuredClone(session);
  for (const block of next.blocks) {
    if (block.id !== blockId) continue;
    for (const entry of block.entries) {
      if (entry.key !== entryKey) continue;
      for (const field of entry.fields) {
        if (field.id === fieldId) field.choice = choice;
      }
      entry.status = entryStatus(entry);
    }
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

/** 冻结决定只接受操作人当前角色有权限给出的候选 */
export function withFreezeChoice(session: MergeSession, blockId: string, choice: MergeChoice): MergeSession {
  const next = structuredClone(session);
  const block = next.blocks.find((item) => item.id === blockId);
  if (!block) return session;
  block.freezeChoice = choice;
  block.freezeAuto = false;
  // 操作人拍板后越权记录保留在卡片上，但不再挂起
  block.freezeNote =
    choice === 'base'
      ? `已按操作人决定保留原冻结状态（${block.freezeBase ? '已冻结' : '未冻结'}），编程执行的越权改动被挡下。`
      : '已按操作人决定采用该冻结候选。';
  next.updatedAt = new Date().toISOString();
  return next;
}

/* ---------------- 生成合并方案 ---------------- */

function sourceCue(entry: MergeCueEntry, choice: MergeChoice): Cue | undefined {
  if (choice === 'base') return entry.baseCue;
  if (choice === 'a') return entry.cueA ?? entry.baseCue ?? entry.cueB;
  return entry.cueB ?? entry.baseCue ?? entry.cueA;
}

export function buildMergedPlan(session: MergeSession): { plan: LightingPlan; warnings: string[] } {
  if (!sessionStats(session).resolved) {
    throw new Error('仍有待处理的合并项，不能生成合并方案。');
  }

  const planId = uid('plan-merged');
  const warnings = [...session.warnings];
  const mergedScenes: Scene[] = [];

  session.blocks.forEach((block, blockIndex) => {
    const baseScene = session.baseSnapshot.scenes.find((scene) => scene.order === block.order);
    const sceneA = session.draftA.plan.scenes.find((scene) => scene.order === block.order);
    const sceneB = session.draftB.plan.scenes.find((scene) => scene.order === block.order);

    // 提示顺序：原方案顺序在前，草稿新增提示按 A、B 追加
    const orderedEntries: MergeCueEntry[] = [];
    baseScene?.cues.forEach((cue) => {
      const entry = block.entries.find((item) => item.key === cue.number);
      if (entry) orderedEntries.push(entry);
    });
    sceneA?.cues.forEach((cue) => {
      if (baseScene?.cues.some((item) => item.number === cue.number)) return;
      const entry = block.entries.find((item) => item.key === cue.number);
      if (entry && !orderedEntries.includes(entry)) orderedEntries.push(entry);
    });
    sceneB?.cues.forEach((cue) => {
      if (baseScene?.cues.some((item) => item.number === cue.number)) return;
      if (sceneA?.cues.some((item) => item.number === cue.number)) return;
      const entry = block.entries.find((item) => item.key === cue.number);
      if (entry && !orderedEntries.includes(entry)) orderedEntries.push(entry);
    });

    const mergedCues: Cue[] = orderedEntries.map((entry) => {
      const seedChoice: MergeChoice = entry.hasBase ? 'base' : entry.hasA ? 'a' : 'b';
      const seed = sourceCue(entry, seedChoice);
      const cue: Cue = structuredClone(seed!);
      cue.id = uid('cue-merged');
      for (const field of entry.fields) {
        const chosen = field.choice ?? seedChoice;
        const source = sourceCue(entry, chosen);
        if (source) {
          cue[field.field] = source[field.field] as never;
        }
      }
      delete cue.startTime;
      delete cue.duration;
      delete cue.endTime;
      return cue;
    });

    const frozen = (() => {
      if (block.freezeChoice === 'a') return Boolean(block.freezeA);
      if (block.freezeChoice === 'b') return Boolean(block.freezeB);
      return block.freezeBase;
    })();

    mergedScenes.push({
      id: uid('scene-merged'),
      name: baseScene?.name ?? sceneA?.name ?? sceneB?.name ?? `第 ${block.order} 场`,
      order: blockIndex + 1,
      frozen,
      cues: mergedCues
    });
  });

  // 全部场次构建完成后，再统一重映射跟随目标。合并方案全部使用新 id，
  // 因此跟随关系用「目标在来源方案中的 (场次顺序, 编号)」精确还原，
  // 正确处理跨场次跟随与同号提示（例如 Q23 在多个场次出现）。
  const orderNumberToId = new Map<string, string>();
  mergedScenes.forEach((scene) => scene.cues.forEach((cue) => orderNumberToId.set(`${scene.order}::${cue.number}`, cue.id)));
  const numberToIds = new Map<string, string[]>();
  mergedScenes.forEach((scene) =>
    scene.cues.forEach((cue) => numberToIds.set(cue.number, [...(numberToIds.get(cue.number) ?? []), cue.id]))
  );

  mergedScenes.forEach((scene, sceneIndex) => {
    const block = session.blocks[sceneIndex];
    scene.cues.forEach((cue) => {
      const entry = block.entries.find((item) => item.key === cue.number);
      const followField = entry?.fields.find((field) => field.field === 'followCueId');
      // 跟随字段存在三方差异时，以操作人选定的一方为准；否则以取值来源的一方为准
      const effectiveChoice: MergeChoice =
        followField?.choice ?? (entry?.hasBase ? 'base' : entry?.hasA ? 'a' : 'b');
      const effectivePlan = effectiveChoice === 'base' ? session.baseSnapshot : effectiveChoice === 'a' ? session.draftA.plan : session.draftB.plan;
      const effectiveCue = effectiveChoice === 'base' ? entry?.baseCue : effectiveChoice === 'a' ? entry?.cueA : entry?.cueB;
      const rawFollow = effectiveCue?.followCueId ?? '';
      if (!rawFollow) {
        cue.followCueId = '';
        return;
      }
      const targetHit = effectivePlan.scenes
        .flatMap((source) => source.cues.map((targetCue) => ({ sceneOrder: source.order, targetCue })))
        .find((item) => item.targetCue.id === rawFollow);
      let mapped: string | undefined;
      if (targetHit) {
        mapped = orderNumberToId.get(`${targetHit.sceneOrder}::${targetHit.targetCue.number}`);
      } else {
        // 草稿引用了来源方案之外的 id：同场次编号优先，唯一候选其次
        const fallbackNumber = followTargetNumber(effectivePlan, rawFollow).replace(/^#/, '');
        const candidates = numberToIds.get(fallbackNumber) ?? [];
        mapped = candidates.find((id) => scene.cues.some((item) => item.id === id)) ?? (candidates.length === 1 ? candidates[0] : undefined);
      }
      if (mapped) {
        cue.followCueId = mapped;
      } else {
        cue.followCueId = '';
        const label = targetHit ? targetHit.targetCue.number : rawFollow;
        warnings.push(`第 ${block.order} 场 ${cue.number} 的跟随目标 ${label} 在合并方案中不存在，已清空为顺序触发。`);
      }
    });
  });


  const plan: LightingPlan = {
    id: planId,
    name: `${session.basePlanName} · 合并方案`,
    description: `由主控方案与「${session.draftA.owner}」「${session.draftB.owner}」合并生成。`,
    updatedAt: new Date().toISOString(),
    scenes: mergedScenes
  };
  recalculatePlans([plan]);
  return { plan, warnings: Array.from(new Set(warnings)) };
}
