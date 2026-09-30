import { samplePlans } from '../data';
import type { Cue, DraftBundle, LightingPlan, Scene } from '../types';
import { draftFromPlan } from './engine';

/**
 * 两份巡演换场离线草稿均基于主控「主舞台方案」：
 * - 草稿 A：灯光设计在控台甲修改
 * - 草稿 B：编程执行在控台乙修改（无权改动冻结状态）
 * 刻意覆盖：双方分歧、单方修改、双方一致、新增提示、跟随目标改动、越权冻结。
 */
function findScene(plan: LightingPlan, order: number): Scene {
  const scene = plan.scenes.find((item) => item.order === order);
  if (!scene) throw new Error(`缺少第 ${order} 场`);
  return scene;
}

function findCue(scene: Scene, number: string): Cue {
  const cue = scene.cues.find((item) => item.number === number);
  if (!cue) throw new Error(`缺少提示 ${number}`);
  return cue;
}

function patch(plan: LightingPlan, order: number, number: string, changes: Partial<Cue>) {
  const cue = findCue(findScene(plan, order), number);
  Object.assign(cue, changes);
}

function setFollowByNumber(plan: LightingPlan, order: number, number: string, targetNumber: string) {
  const scene = findScene(plan, order);
  patch(plan, order, number, { followCueId: findCue(scene, targetNumber).id });
}

export function buildSampleDrafts(): { draftA: DraftBundle; draftB: DraftBundle } {
  const base = samplePlans.find((plan) => plan.id === 'plan-main')!;

  // 草稿 A：灯光设计
  const planA = structuredClone(base);
  planA.updatedAt = '2026-09-28T22:10:00.000Z';
  // 单方修改：通道
  patch(planA, 1, 'Q1', { channel: 'House Master' });
  // 双方分歧：保持时间
  patch(planA, 1, 'Q3', { hold: 24 });
  // 双方一致：亮度
  patch(planA, 2, 'Q11', { brightness: 78 });
  // 双方分歧：亮度
  patch(planA, 2, 'Q12', { brightness: 44 });
  // 双方分歧：跟随目标（A 指回本场内的 Q11）
  setFollowByNumber(planA, 2, 'Q12', 'Q11');
  // 双方分歧：渐出
  patch(planA, 3, 'Q22', { fadeOut: 5, brightness: 90 });
  setFollowByNumber(planA, 3, 'Q22', 'Q20');
  // 灯光设计请求解冻终场（有权限，自动并入）
  findScene(planA, 4).frozen = false;
  patch(planA, 4, 'Q30', { brightness: 52, notes: '解冻后微调：长椅定点略提亮度。' });
  // 新增第 5 场（仅 A 有）
  planA.scenes.push({
    id: 'designer-scene-5',
    name: '谢幕 · 返场',
    order: 5,
    frozen: false,
    cues: [
      {
        id: 'designer-cue-40',
        number: 'Q40',
        label: '返场暖光',
        position: '全台',
        channel: 'FOH 1-4',
        color: '暖白',
        colorHex: '#FFF1C7',
        brightness: 80,
        fadeIn: 6,
        hold: 30,
        fadeOut: 8,
        followCueId: '',
        targetNote: '主演返场',
        notes: '灯光设计新增：谢幕整体提亮。',
        status: 'ready'
      }
    ]
  });

  // 草稿 B：编程执行
  const planB = structuredClone(base);
  planB.updatedAt = '2026-09-28T22:40:00.000Z';
  // 单方修改：保持 + 备注
  patch(planB, 1, 'Q3', { notes: '编程实测：独白保持略加 2 秒更贴台词。' });
  patch(planB, 1, 'Q3', { hold: 26 });
  // 双方一致：亮度
  patch(planB, 2, 'Q11', { brightness: 78, targetNote: '吸气点触发（实测提前半拍）' });
  // 双方分歧：亮度
  patch(planB, 2, 'Q12', { brightness: 62 });
  // 双方分歧：跟随目标（B 指向不存在的外部控台编号）
  patch(planB, 2, 'Q12', { followCueId: 'console-xyz-Q99' });
  // 单方修改：通道
  patch(planB, 3, 'Q21', { channel: 'Side 1-6' });
  // 双方分歧：渐出
  patch(planB, 3, 'Q22', { fadeOut: 10 });
  // 单方新增提示
  {
    const scene3 = findScene(planB, 3);
    scene3.cues.push({
      id: 'programmer-cue-24',
      number: 'Q24',
      label: '尾奏黑场',
      position: '全台',
      channel: 'Grand Master',
      color: '黑场',
      colorHex: '#000000',
      brightness: 0,
      fadeIn: 1,
      hold: 4,
      fadeOut: 10,
      followCueId: findCue(scene3, 'Q23').id,
      targetNote: '尾奏最后一拍',
      notes: '编程执行新增：尾奏干净收黑。',
      status: 'draft'
    });
  }
  // 越权：编程执行试图解除终场冻结，必须挡下
  findScene(planB, 4).frozen = false;
  patch(planB, 4, 'Q31', { targetNote: '编程巡演台提议：黑场后再抬头。' });

  return {
    draftA: {
      ...draftFromPlan(planA, 'designer', '灯光设计 · 控台甲'),
      fileName: 'cue-desk-A-designer-tour.json'
    },
    draftB: {
      ...draftFromPlan(planB, 'programmer', '编程执行 · 控台乙'),
      fileName: 'cue-desk-B-programmer-tour.json'
    }
  };
}
