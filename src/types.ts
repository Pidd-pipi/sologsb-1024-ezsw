export type CueStatus = 'draft' | 'ready' | 'confirmed';
export type UserRole = 'designer' | 'programmer' | 'stage-manager' | 'readonly';
export type ConflictSeverity = 'error' | 'warning';

export interface Cue {
  id: string;
  number: string;
  label: string;
  position: string;
  channel: string;
  color: string;
  colorHex: string;
  brightness: number;
  fadeIn: number;
  hold: number;
  fadeOut: number;
  followCueId: string;
  targetNote: string;
  notes: string;
  status: CueStatus;
  startTime?: number;
  duration?: number;
  endTime?: number;
}

export interface Scene {
  id: string;
  name: string;
  order: number;
  frozen: boolean;
  startTime?: number;
  duration?: number;
  cues: Cue[];
}

export interface LightingPlan {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  scenes: Scene[];
}

export interface CueConflict {
  id: string;
  planId: string;
  cueId: string;
  sceneId: string;
  severity: ConflictSeverity;
  type: 'channel-overlap' | 'follow-order' | 'missing-data' | 'duplicate-position' | 'duration';
  message: string;
}

export interface Workspace {
  plans: LightingPlan[];
  activePlanId: string;
  comparePlanId: string;
  selectedSceneId: string;
  selectedCueId: string;
  role: UserRole;
  mergeSessions: MergeSession[];
}

export interface EditorState {
  workspace: Workspace;
  past: Workspace[];
  future: Workspace[];
  lastAction: string;
}

export interface PersistedState {
  workspace: Workspace;
}

/* ---------- 离线草稿合并 ---------- */

export type DraftRole = 'designer' | 'programmer';
export type MergeChoice = 'base' | 'a' | 'b';
export type MergeFieldGroup = 'channel' | 'brightness' | 'fade' | 'follow' | 'other';
export type MergeFieldKey =
  | 'channel'
  | 'brightness'
  | 'fadeIn'
  | 'hold'
  | 'fadeOut'
  | 'followCueId'
  | 'label'
  | 'position'
  | 'color'
  | 'colorHex'
  | 'targetNote'
  | 'notes'
  | 'status';

export interface DraftBundle {
  role: DraftRole;
  owner: string;
  savedAt: string;
  fileName?: string;
  plan: LightingPlan;
}

export interface FieldConflict {
  id: string;
  field: MergeFieldKey;
  baseValue: unknown;
  valueA: unknown;
  valueB: unknown;
  /** 草稿侧跟随目标对应的提示编号，用于跨文件 id 的语义对齐 */
  targetBase?: string;
  targetA?: string;
  targetB?: string;
  /** null 表示尚未选择（待处理）；其余为最终取值来源 */
  choice: MergeChoice | null;
  /** 仅一方修改或双方一致时自动并入，操作人仍可改回 */
  auto: boolean;
}

export type MergeEntryStatus = 'pending' | 'auto' | 'resolved';

export interface MergeCueEntry {
  key: string;
  number: string;
  hasBase: boolean;
  hasA: boolean;
  hasB: boolean;
  baseCue?: Cue;
  cueA?: Cue;
  cueB?: Cue;
  fields: FieldConflict[];
  status: MergeEntryStatus;
}

export interface MergeSceneBlock {
  id: string;
  order: number;
  hasBase: boolean;
  hasA: boolean;
  hasB: boolean;
  baseSceneId?: string;
  nameBase?: string;
  nameA?: string;
  nameB?: string;
  freezeBase: boolean;
  freezeA?: boolean;
  freezeB?: boolean;
  /** 冻结决定取值来源；越权拦截或多方分歧时为 null，等待操作人 */
  freezeChoice: MergeChoice | null;
  freezeAuto: boolean;
  /** 编程执行草稿试图改动冻结状态，被挡下 */
  freezeBlocked: boolean;
  freezeNote: string;
  entries: MergeCueEntry[];
}

export type MergeSessionStatus = 'open' | 'completed';

export interface MergeSession {
  id: string;
  basePlanId: string;
  basePlanName: string;
  baseSnapshot: LightingPlan;
  draftA: DraftBundle;
  draftB: DraftBundle;
  blocks: MergeSceneBlock[];
  status: MergeSessionStatus;
  resultPlanId?: string;
  resultPlanName?: string;
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MergeStats {
  scenes: number;
  entries: number;
  newCues: number;
  autoChanges: number;
  pendingFields: number;
  pendingEntries: number;
  blockedFreezes: number;
  pendingFreezes: number;
  resolved: boolean;
}
