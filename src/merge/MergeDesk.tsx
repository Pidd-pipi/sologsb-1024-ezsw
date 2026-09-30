import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  HStack,
  Heading,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Spacer,
  Tag,
  Text,
  Tooltip,
  VStack,
  useToast
} from '@chakra-ui/react';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  FileJson,
  FileUp,
  GitMerge,
  Lock,
  Plus,
  ShieldOff,
  Sparkles,
  Trash2
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  DraftParseError,
  buildMergedPlan,
  createMergeSession,
  fieldMeta,
  formatFieldValue,
  keyFields,
  parseDraftFile,
  sessionStats
} from './engine';
import { buildSampleDrafts } from './samples';
import { canFreeze } from '../state/useLightingDesk';
import { roleLabels } from '../data';
import type {
  DraftBundle,
  DraftRole,
  FieldConflict,
  LightingPlan,
  MergeChoice,
  MergeCueEntry,
  MergeSceneBlock,
  MergeSession,
  UserRole
} from '../types';

interface MergeDeskProps {
  open: boolean;
  onClose: () => void;
  plans: LightingPlan[];
  role: UserRole;
  sessions: MergeSession[];
  onCreate: (session: MergeSession) => void;
  onFieldChoice: (sessionId: string, blockId: string, entryKey: string, fieldId: string, choice: MergeChoice) => void;
  onFreezeChoice: (sessionId: string, blockId: string, choice: MergeChoice) => void;
  onFinish: (sessionId: string, plan: LightingPlan, warnings: string[]) => void;
  onRemove: (sessionId: string) => void;
  onOpenPlan: (planId: string) => void;
}

const sideName = {
  a: '草稿 A',
  b: '草稿 B',
  base: '原方案'
} as const;

const sideColor = {
  a: 'blue',
  b: 'purple',
  base: 'whiteAlpha'
} as const;

function sideRoleTag(side: 'a' | 'b', draft: DraftBundle) {
  return (
    <Tag size="sm" colorScheme={side === 'a' ? 'blue' : 'purple'}>
      {side === 'a' ? 'A' : 'B'} · {draft.role === 'designer' ? roleLabels.designer : roleLabels.programmer}
    </Tag>
  );
}

/* ---------- 值单元格与候选选择 ---------- */

function ValueCell({ text, tone }: { text: string; tone: 'base' | 'a' | 'b' }) {
  const color = tone === 'a' ? 'blue.200' : tone === 'b' ? 'purple.200' : 'whiteAlpha.600';
  return (
    <Text fontSize="xs" color={color} fontFamily={String(text).length <= 12 ? 'mono' : undefined} noOfLines={2}>
      {text}
    </Text>
  );
}

function ChoiceButton({
  selected,
  disabled,
  tone,
  label,
  onClick,
  ariaLabel
}: {
  selected: boolean;
  disabled: boolean;
  tone: 'base' | 'a' | 'b';
  label: string;
  onClick: () => void;
  ariaLabel: string;
}) {
  const palette =
    tone === 'a'
      ? selected
        ? 'blue'
        : 'whiteAlpha'
      : tone === 'b'
        ? selected
          ? 'purple'
          : 'whiteAlpha'
        : selected
          ? 'gray'
          : 'whiteAlpha';
  return (
    <Button
      size="xs"
      flex="1"
      variant={selected ? 'solid' : 'outline'}
      colorScheme={palette}
      isDisabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={selected}
      onClick={onClick}
      h="auto"
      py={1.5}
      whiteSpace="normal"
    >
      {label}
    </Button>
  );
}

function FieldRow({
  field,
  canDecide,
  onChange
}: {
  field: FieldConflict;
  canDecide: boolean;
  onChange: (choice: MergeChoice) => void;
}) {
  const meta = fieldMeta(field.field);
  const pending = field.choice === null;
  const options: { choice: MergeChoice; tone: 'base' | 'a' | 'b'; value: unknown; available: boolean }[] = [
    { choice: 'base', tone: 'base', value: field.baseValue, available: field.baseValue !== undefined },
    { choice: 'a', tone: 'a', value: field.valueA, available: field.valueA !== undefined },
    { choice: 'b', tone: 'b', value: field.valueB, available: field.valueB !== undefined }
  ];
  return (
    <Box
      p={2.5}
      borderRadius="md"
      borderWidth="1px"
      borderColor={pending ? 'orange.600' : 'whiteAlpha.100'}
      bg={pending ? 'orange.900' : 'blackAlpha.200'}
      role="group"
      aria-label={`${meta.label} 合并项`}
    >
      <Flex align="center" gap={2} mb={1.5}>
        <Text fontSize="xs" fontWeight="700" color="whiteAlpha.800">{meta.label}</Text>
        {pending ? (
          <Tag size="sm" colorScheme="orange">待选择</Tag>
        ) : field.auto ? (
          <Tag size="sm" colorScheme="green">自动并入 · 来自{sideName[field.choice as MergeChoice]}</Tag>
        ) : (
          <Tag size="sm" colorScheme="teal">已选 {sideName[field.choice as MergeChoice]}</Tag>
        )}
        {meta.group === 'channel' ? <Tag size="sm">通道</Tag> : null}
        {meta.group === 'brightness' ? <Tag size="sm">亮度</Tag> : null}
        {meta.group === 'fade' ? <Tag size="sm">渐变</Tag> : null}
        {meta.group === 'follow' ? <Tag size="sm" colorScheme="pink">跟随</Tag> : null}
      </Flex>
      <Flex gap={2} mb={2}>
        {options.map((option) => (
          <Box
            key={option.choice}
            flex="1"
            minW={0}
            p={1.5}
            borderRadius="md"
            bg="whiteAlpha.50"
            opacity={option.available ? 1 : 0.35}
          >
            <Text fontSize="9px" color="whiteAlpha.500" mb={0.5}>{sideName[option.choice]}</Text>
            <ValueCell tone={option.tone} text={formatFieldValue(field.field, option.value)} />
          </Box>
        ))}
      </Flex>
      <Flex gap={1.5} role="radiogroup" aria-label={`${meta.label} 候选选择`}>
        {options.map((option) => (
          <ChoiceButton
            key={option.choice}
            tone={option.tone}
            label={`采用${sideName[option.choice]}`}
            ariaLabel={`${meta.label}：采用${sideName[option.choice]}的值 ${formatFieldValue(field.field, option.value)}`}
            selected={field.choice === option.choice}
            disabled={!canDecide || !option.available}
            onClick={() => onChange(option.choice)}
          />
        ))}
      </Flex>
    </Box>
  );
}

/* ---------- 提示条目 ---------- */

function CueEntryCard({
  entry,
  canEditFields,
  onChoose
}: {
  entry: MergeCueEntry;
  canEditFields: boolean;
  onChoose: (fieldId: string, choice: MergeChoice) => void;
}) {
  const sourceCue = entry.baseCue ?? entry.cueA ?? entry.cueB;
  const keyFieldConflicts = entry.fields.filter((field) => keyFields.includes(field.field));
  const otherConflicts = entry.fields.filter((field) => !keyFields.includes(field.field));
  const pending = entry.status === 'pending';
  return (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      borderColor={pending ? 'orange.600' : 'whiteAlpha.100'}
      bg="whiteAlpha.50"
      p={3}
    >
      <Flex align="center" gap={2} mb={2} wrap="wrap">
        <Text fontFamily="mono" color="amber.300" fontWeight="800">{entry.number}</Text>
        <Text fontWeight="700" fontSize="sm" noOfLines={1}>{sourceCue?.label}</Text>
        <Tag size="sm" colorScheme="whiteAlpha">{entry.baseCue?.position ?? entry.cueA?.position ?? entry.cueB?.position}</Tag>
        <HStack spacing={1}>
          <Tag size="sm" colorScheme={entry.hasBase ? 'gray' : 'green'}>{entry.hasBase ? '原方案' : '新增'}</Tag>
          {entry.hasA ? <Tag size="sm" colorScheme="blue">A 改</Tag> : <Tag size="sm" colorScheme="whiteAlpha">A 无</Tag>}
          {entry.hasB ? <Tag size="sm" colorScheme="purple">B 改</Tag> : <Tag size="sm" colorScheme="whiteAlpha">B 无</Tag>}
        </HStack>
        <Spacer />
        {pending ? (
          <Tag colorScheme="orange"><HStack spacing={1}><AlertTriangle size={12} /><Text>待处理</Text></HStack></Tag>
        ) : (
          <Tag colorScheme="green"><HStack spacing={1}><CheckCircle2 size={12} /><Text>已对齐</Text></HStack></Tag>
        )}
      </Flex>
      {entry.fields.length === 0 ? (
        <Text fontSize="xs" color="green.300">两份草稿与原方案完全一致，无需处理。</Text>
      ) : (
        <VStack align="stretch" spacing={2}>
          {keyFieldConflicts.map((field) => (
            <FieldRow
              key={field.id}
              field={field}
              canDecide={canEditFields}
              onChange={(choice) => onChoose(field.id, choice)}
            />
          ))}
          {otherConflicts.length ? (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'rgba(255,255,255,.6)' }}>
                其余字段差异（{otherConflicts.length}）：灯位、名称、颜色、触发点、备注、状态
              </summary>
              <VStack align="stretch" spacing={2} mt={2}>
                {otherConflicts.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    canDecide={canEditFields}
                    onChange={(choice) => onChoose(field.id, choice)}
                  />
                ))}
              </VStack>
            </details>
          ) : null}
        </VStack>
      )}
    </Box>
  );
}

/* ---------- 冻结决定卡片（越权拦截） ---------- */

function FreezeCard({
  block,
  roleA,
  roleB,
  canDecide,
  onChoose
}: {
  block: MergeSceneBlock;
  roleA: DraftRole;
  roleB: DraftRole;
  canDecide: boolean;
  onChoose: (choice: MergeChoice) => void;
}) {
  const pending = block.freezeChoice === null;
  const makeOption = (side: 'a' | 'b', value: boolean | undefined) => {
    const changed = value !== undefined && value !== block.freezeBase;
    return {
      choice: side,
      label: side === 'a' ? '采用草稿 A' : '采用草稿 B',
      value: value === undefined ? `${side.toUpperCase()} 未改动` : value ? '请求冻结' : '请求解冻',
      available: changed,
      // 只有“编程执行 + 确实提出冻结改动”才算越权；灯光设计的改动是合法候选
      forbidden: changed && (side === 'a' ? roleA : roleB) === 'programmer'
    };
  };
  const options: { choice: MergeChoice; label: string; value: string; available: boolean; forbidden?: boolean }[] = [
    { choice: 'base', label: '保留原值', value: block.freezeBase ? '保持冻结' : '保持未冻结', available: true },
    makeOption('a', block.freezeA),
    makeOption('b', block.freezeB)
  ];
  return (
    <Alert
      status={block.freezeBlocked ? 'error' : pending ? 'warning' : 'success'}
      variant="left-accent"
      borderRadius="lg"
      flexDirection="column"
      alignItems="stretch"
      gap={2}
      role="region"
      aria-label={`第 ${block.order} 场冻结状态决定`}
    >
      <Flex align="center" gap={2}>
        <AlertIcon />
        {block.freezeBlocked ? <ShieldOff size={16} color="#fc8181" /> : <Lock size={15} />}
        <Text fontSize="sm" fontWeight="700">冻结状态</Text>
        <Tag size="sm">原方案：{block.freezeBase ? '已冻结' : '未冻结'}</Tag>
        {pending ? <Tag colorScheme="orange">待处理</Tag> : <Tag colorScheme="green">已决定</Tag>}
      </Flex>
      <AlertDescription fontSize="xs">{block.freezeNote}</AlertDescription>
      <Flex gap={2} role="radiogroup" aria-label={`第 ${block.order} 场冻结候选`}>
        {options.map((option) => {
          const blocked = option.forbidden;
          return (
            <Box key={option.choice} flex="1" minW={0}>
              <ChoiceButton
                tone={option.choice === 'base' ? 'base' : option.choice === 'a' ? 'a' : 'b'}
                label={`${option.label} · ${option.value}${blocked ? '（越权挡下）' : ''}`}
                ariaLabel={`冻结状态：${option.label}，${option.value}${blocked ? '，编程执行越权，已被挡下' : ''}`}
                selected={block.freezeChoice === option.choice}
                disabled={!canDecide || !option.available || Boolean(blocked && option.choice !== block.freezeChoice)}
                onClick={() => onChoose(option.choice)}
              />
            </Box>
          );
        })}
      </Flex>
      {block.freezeBlocked ? (
        <Text fontSize="10px" color="red.200">
          <Ban size={10} style={{ display: 'inline', marginRight: 4 }} />
          编程执行角色无权改动冻结状态；该越权内容不会进入合并方案，必须由灯光设计/舞台监督在本机处理后任务才会消失。
        </Text>
      ) : null}
    </Alert>
  );
}

/* ---------- 单场区块 ---------- */

function SceneBlock({
  block,
  role,
  roleA,
  roleB,
  onField,
  onFreeze
}: {
  block: MergeSceneBlock;
  role: UserRole;
  roleA: DraftRole;
  roleB: DraftRole;
  onField: (entryKey: string, fieldId: string, choice: MergeChoice) => void;
  onFreeze: (choice: MergeChoice) => void;
}) {
  const pendingEntries = block.entries.filter((entry) => entry.status === 'pending').length;
  const sceneName = block.nameBase ?? block.nameA ?? block.nameB ?? `第 ${block.order} 场`;
  return (
    <Box borderWidth="1px" borderColor="whiteAlpha.100" borderRadius="xl" bg="whiteAlpha.50" p={4}>
      <Flex align="center" gap={2} mb={1} wrap="wrap">
        <Text color="amber.300" fontFamily="mono" fontSize="sm">第 {block.order} 场</Text>
        <Heading size="sm">{sceneName}</Heading>
        {!block.hasBase ? <Tag colorScheme="green">草稿新增场次</Tag> : null}
        {pendingEntries ? <Tag colorScheme="orange">{pendingEntries} 条提示待处理</Tag> : null}
        {block.freezeChoice === null ? <Tag colorScheme="red">冻结待处理</Tag> : null}
      </Flex>
      <HStack mb={3} mt={1} wrap="wrap">
        <Text fontSize="11px" color="whiteAlpha.500">场次名称：</Text>
        <Tag size="sm" colorScheme="whiteAlpha">原：{block.nameBase ?? '—'}</Tag>
        <Tag size="sm" colorScheme="blue">A：{block.nameA ?? '—'}</Tag>
        <Tag size="sm" colorScheme="purple">B：{block.nameB ?? '—'}</Tag>
      </HStack>

      <Box mb={3}>
        <FreezeCard block={block} roleA={roleA} roleB={roleB} canDecide={canFreeze(role)} onChoose={onFreeze} />
      </Box>

      <VStack align="stretch" spacing={3}>
        {block.entries.map((entry) => (
          <CueEntryCard
            key={entry.key}
            entry={entry}
            canEditFields={role !== 'readonly' && role !== 'stage-manager'}
            onChoose={(fieldId, choice) => onField(entry.key, fieldId, choice)}
          />
        ))}
      </VStack>
    </Box>
  );
}

/* ---------- 导入表单 ---------- */

function DraftDropzone({
  side,
  draft,
  onFile,
  onRoleChange,
  onClear,
  disabled
}: {
  side: 'a' | 'b';
  draft: DraftBundle | null;
  onFile: (draft: DraftBundle) => void;
  onRoleChange: (role: DraftRole) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  async function handleFile(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      onFile(parseDraftFile(text, file.name));
    } catch (error) {
      const message = error instanceof DraftParseError ? error.message : '草稿读取失败。';
      toast({ title: '无法导入草稿', description: message, status: 'error', duration: 2600 });
    }
  }
  return (
    <Box
      borderWidth="1px"
      borderStyle="dashed"
      borderColor={side === 'a' ? 'blue.500' : 'purple.500'}
      borderRadius="xl"
      p={4}
      bg="blackAlpha.300"
    >
      <Flex align="center" gap={2} mb={2}>
        <Badge colorScheme={side === 'a' ? 'blue' : 'purple'} fontSize="md" px={2}>{side.toUpperCase()}</Badge>
        <Text fontWeight="700" fontSize="sm">{side === 'a' ? '控台甲 · 灯光设计草稿' : '控台乙 · 编程执行草稿'}</Text>
      </Flex>
      {draft ? (
        <VStack align="stretch" spacing={1.5}>
          <HStack>
            <FileJson size={15} color="#90cdf4" />
            <Text fontSize="sm" fontWeight="600" noOfLines={1}>{draft.fileName ?? draft.owner}</Text>
          </HStack>
          <Text fontSize="xs" color="whiteAlpha.500">{draft.plan.name} · {draft.plan.scenes.length} 场 · {new Date(draft.savedAt).toLocaleString('zh-CN')}</Text>
          <HStack>
            <Select
              size="xs"
              w="150px"
              aria-label={`草稿 ${side.toUpperCase()} 作者角色`}
              value={draft.role}
              isDisabled={disabled}
              onChange={(event) => onRoleChange(event.target.value as DraftRole)}
            >
              <option value="designer">{roleLabels.designer}</option>
              <option value="programmer">{roleLabels.programmer}</option>
            </Select>
            <Button size="xs" variant="ghost" leftIcon={<Trash2 size={12} />} isDisabled={disabled} onClick={onClear}>移除</Button>
          </HStack>
        </VStack>
      ) : (
        <VStack spacing={2}>
          <Button
            w="full"
            variant="outline"
            leftIcon={<FileUp size={16} />}
            isDisabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            选择离线草稿 JSON
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <Text fontSize="10px" color="whiteAlpha.500">支持设计台导出 JSON，或直接包含 scenes/cues 的方案文件。</Text>
        </VStack>
      )}
    </Box>
  );
}

function ImportView({
  plans,
  role,
  onCreate
}: {
  plans: LightingPlan[];
  role: UserRole;
  onCreate: (basePlanId: string, draftA: DraftBundle, draftB: DraftBundle) => void;
}) {
  const [basePlanId, setBasePlanId] = useState(plans[0]?.id ?? '');
  const [draftA, setDraftA] = useState<DraftBundle | null>(null);
  const [draftB, setDraftB] = useState<DraftBundle | null>(null);
  const locked = role === 'readonly';
  const ready = Boolean(basePlanId && draftA && draftB);

  function loadSamples() {
    const { draftA: a, draftB: b } = buildSampleDrafts();
    setDraftA(a);
    setDraftB(b);
    setBasePlanId((current) => current || plans.find((plan) => plan.id === 'plan-main')?.id || plans[0]?.id || '');
  }

  function mutateDraft(side: 'a' | 'b', patch: Partial<DraftBundle>) {
    const setter = side === 'a' ? setDraftA : setDraftB;
    setter((current) => (current ? { ...current, ...patch } : current));
  }

  return (
    <VStack align="stretch" spacing={4}>
      <Alert status="info" borderRadius="lg">
        <AlertIcon />
        <AlertDescription fontSize="sm">
          导入两份离线草稿后，按「场次顺序 → 提示编号 → 灯位/通道」对齐；不同提示直接并入，同一提示的通道、亮度、渐变、跟随目标存在两套新值时，保留原值与双方候选，由操作人逐项选定。原方案不会被覆盖。
        </AlertDescription>
      </Alert>

      <Box borderWidth="1px" borderColor="whiteAlpha.100" borderRadius="xl" p={4} bg="whiteAlpha.50">
        <FormLabelLite>主控基准方案（合并前的原方案，保持可查）</FormLabelLite>
        <Select aria-label="主控基准方案" value={basePlanId} onChange={(event) => setBasePlanId(event.target.value)}>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>{plan.name} · {plan.scenes.length} 场</option>
          ))}
        </Select>
      </Box>

      <Grid2>
        <DraftDropzone side="a" draft={draftA} disabled={locked} onFile={setDraftA} onClear={() => setDraftA(null)} onRoleChange={(value) => mutateDraft('a', { role: value })} />
        <DraftDropzone side="b" draft={draftB} disabled={locked} onFile={setDraftB} onClear={() => setDraftB(null)} onRoleChange={(value) => mutateDraft('b', { role: value })} />
      </Grid2>

      <HStack>
        <Button size="sm" variant="ghost" leftIcon={<Sparkles size={14} />} isDisabled={locked} onClick={loadSamples}>
          载入两份巡演示例草稿
        </Button>
        <Spacer />
        <Button
          colorScheme="amber"
          leftIcon={<GitMerge size={16} />}
          isDisabled={!ready || locked}
          onClick={() => {
            const base = plans.find((plan) => plan.id === basePlanId);
            if (base && draftA && draftB) onCreate(base.id, draftA, draftB);
          }}
        >
          对齐草稿并建立合并任务
        </Button>
      </HStack>
      {locked ? <Text fontSize="xs" color="orange.300">只读角色不能导入或合并草稿。</Text> : null}
    </VStack>
  );
}

function FormLabelLite({ children }: { children: React.ReactNode }) {
  return <Text fontSize="xs" fontWeight="700" color="whiteAlpha.700" mb={1.5}>{children}</Text>;
}

function Grid2({ children }: { children: React.ReactNode }) {
  return (
    <Box display="grid" gridTemplateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={3}>
      {children}
    </Box>
  );
}

/* ---------- 会话详情 ---------- */

function SessionView({
  session,
  role,
  onField,
  onFreeze,
  onFinish,
  onOpenPlan
}: {
  session: MergeSession;
  role: UserRole;
  onField: (blockId: string, entryKey: string, fieldId: string, choice: MergeChoice) => void;
  onFreeze: (blockId: string, choice: MergeChoice) => void;
  onFinish: () => void;
  onOpenPlan: (planId: string) => void;
}) {
  const stats = useMemo(() => sessionStats(session), [session]);
  const completed = session.status === 'completed';
  return (
    <VStack align="stretch" spacing={4}>
      <Box borderWidth="1px" borderColor="whiteAlpha.100" borderRadius="xl" bg="whiteAlpha.50" p={4}>
        <Flex align="center" gap={2} wrap="wrap">
          <Heading size="sm">{session.basePlanName} × 2 份离线草稿</Heading>
          {completed ? <Tag colorScheme="green">合并方案已生成</Tag> : stats.resolved ? <Tag colorScheme="teal">全部处理完毕</Tag> : <Tag colorScheme="orange">处理中</Tag>}
          <Spacer />
          <Text fontSize="11px" color="whiteAlpha.500">最近更新 {new Date(session.updatedAt).toLocaleString('zh-CN')}</Text>
        </Flex>
        <HStack mt={3} wrap="wrap" spacing={2}>
          <Stat label="场次" value={stats.scenes} />
          <Stat label="提示对齐" value={stats.entries} />
          <Stat label="草稿新增提示" value={stats.newCues} tone="green" />
          <Stat label="自动并入差异" value={stats.autoChanges} tone="green" />
          <Stat label="待选字段" value={stats.pendingFields} tone={stats.pendingFields ? 'orange' : 'green'} />
          <Stat label="越权冻结拦截" value={stats.blockedFreezes} tone={stats.blockedFreezes ? 'red' : 'green'} />
        </HStack>
        <HStack mt={3} wrap="wrap">
          {sideRoleTag('a', session.draftA)}
          <Text fontSize="11px" color="whiteAlpha.500">{session.draftA.owner} · {session.draftA.fileName ?? '内置草稿'}</Text>
          <Tag mx={1} colorScheme="whiteAlpha">×</Tag>
          {sideRoleTag('b', session.draftB)}
          <Text fontSize="11px" color="whiteAlpha.500">{session.draftB.owner} · {session.draftB.fileName ?? '内置草稿'}</Text>
        </HStack>
      </Box>

      {stats.pendingFreezes > 0 ? (
        <Alert status="error" borderRadius="lg">
          <ShieldOff size={16} />
          <AlertDescription fontSize="sm" ml={2}>
            有 {stats.pendingFreezes} 个场次的冻结状态待处理，其中编程执行越权改动已被挡下。需由灯光设计或舞台监督拍板后才能生成合并方案。
          </AlertDescription>
        </Alert>
      ) : null}
      {stats.pendingFields > 0 ? (
        <Alert status="warning" borderRadius="lg">
          <AlertTriangle size={16} />
          <AlertDescription fontSize="sm" ml={2}>
            有 {stats.pendingFields} 个字段在两份草稿中给出了不同的新值（分布在 {stats.pendingEntries} 条提示），请在下方逐项选定；原值与双方候选均已保留。
          </AlertDescription>
        </Alert>
      ) : null}

      {completed && session.resultPlanId ? (
        <Alert status="success" borderRadius="lg" flexDirection="column" alignItems="stretch">
          <Flex align="center" gap={2}>
            <AlertIcon />
            <Text fontWeight="700" fontSize="sm">合并方案「{session.resultPlanName}」已生成，全剧时间、跟随顺序与通道冲突已重新计算。原方案继续保留可查。</Text>
          </Flex>
          <Box ml={7} mt={2}>
            <Button size="sm" colorScheme="amber" onClick={() => onOpenPlan(session.resultPlanId!)}>打开合并方案查看</Button>
          </Box>
        </Alert>
      ) : null}

      {session.warnings.length ? (
        <Alert status="info" borderRadius="lg" flexDirection="column" alignItems="stretch">
          {session.warnings.map((warning) => (
            <Text key={warning} fontSize="xs">· {warning}</Text>
          ))}
        </Alert>
      ) : null}

      {session.blocks.map((block) => (
        <SceneBlock
          key={block.id}
          block={block}
          role={role}
          roleA={session.draftA.role}
          roleB={session.draftB.role}
          onField={(entryKey, fieldId, choice) => onField(block.id, entryKey, fieldId, choice)}
          onFreeze={(choice) => onFreeze(block.id, choice)}
        />
      ))}

      {!completed ? (
        <Box position="sticky" bottom={2}>
          <Flex
            p={3}
            borderRadius="xl"
            borderWidth="1px"
            borderColor={stats.resolved ? 'green.600' : 'orange.600'}
            bg="stage.900"
            boxShadow="0 10px 30px rgba(0,0,0,.45)"
            align="center"
            gap={3}
            wrap="wrap"
          >
            {stats.resolved ? <CheckCircle2 color="#68d391" /> : <AlertTriangle color="#f6ad55" />}
            <Text fontSize="sm">
              {stats.resolved
                ? `所有合并项已处理：自动并入 ${stats.autoChanges} 处差异，可以生成合并方案。`
                : `还有 ${stats.pendingFields} 个字段候选与 ${stats.pendingFreezes} 个冻结决定待处理。`}
            </Text>
            <Spacer />
            <Button
              colorScheme="amber"
              leftIcon={<GitMerge size={16} />}
              isDisabled={!stats.resolved || role === 'readonly'}
              onClick={onFinish}
            >
              生成合并方案并重算
            </Button>
          </Flex>
        </Box>
      ) : null}
    </VStack>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'orange' | 'red' }) {
  const color = tone === 'green' ? 'green.300' : tone === 'orange' ? 'orange.300' : tone === 'red' ? 'red.300' : 'whiteAlpha.900';
  return (
    <Box bg="blackAlpha.300" borderRadius="lg" px={3} py={2} minW="96px">
      <Text fontSize="lg" fontWeight="800" color={color}>{value}</Text>
      <Text fontSize="10px" color="whiteAlpha.500">{label}</Text>
    </Box>
  );
}

/* ---------- 主组件 ---------- */

export default function MergeDesk({
  open,
  onClose,
  plans,
  role,
  sessions,
  onCreate,
  onFieldChoice,
  onFreezeChoice,
  onFinish,
  onRemove,
  onOpenPlan
}: MergeDeskProps) {
  const [view, setView] = useState<'list' | 'import'>('list');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const openCount = sessions.filter((session) => session.status === 'open').length;
  const toast = useToast();

  function create(basePlanId: string, draftA: DraftBundle, draftB: DraftBundle) {
    const base = plans.find((plan) => plan.id === basePlanId);
    if (!base) return;
    if (base.scenes.length === 0) {
      toast({ title: '基准方案没有场次，无法对齐。', status: 'warning' });
      return;
    }
    const session = createMergeSession(base, draftA, draftB);
    onCreate(session);
    setActiveSessionId(session.id);
    setView('list');
    toast({ title: '两份草稿已按场次与提示编号对齐', description: '请逐项处理待选差异与冻结越权。', status: 'success', duration: 2400 });
  }

  function finish(session: MergeSession) {
    try {
      const { plan, warnings } = buildMergedPlan(session);
      onFinish(session.id, plan, warnings);
      toast({
        title: '合并方案已生成',
        description: warnings.length ? `已重算；另有 ${warnings.length} 条跟随/对齐提示。` : '全剧时间、跟随顺序与通道冲突已重算。',
        status: 'success',
        duration: 2800
      });
    } catch (error) {
      toast({ title: (error as Error).message, status: 'error' });
    }
  }

  return (
    <Modal isOpen={open} onClose={onClose} size="full" scrollBehavior="inside" isCentered={false}>
      <ModalOverlay bg="rgba(3,7,14,.82)" />
      <ModalContent bg="stage.950" margin={0} minH="100vh" borderRadius={0}>
        <ModalHeader borderBottomWidth="1px" borderColor="whiteAlpha.100" px={{ base: 3, lg: 5 }} py={3}>
          <Flex align="center" gap={3} wrap="wrap">
            <IconButton aria-label="返回设计台" icon={<ArrowLeft size={18} />} size="sm" variant="ghost" onClick={onClose} />
            <GitMerge size={20} color="#f6c453" />
            <Box>
              <Heading size="sm">离线草稿合并台</Heading>
              <Text fontSize="11px" color="whiteAlpha.500">巡演双机草稿三方对齐 · 候选留痕 · 冻结越权拦截 · 断点续做</Text>
            </Box>
            <Spacer />
            <Button
              size="sm"
              colorScheme={view === 'import' ? 'whiteAlpha' : 'amber'}
              variant={view === 'import' ? 'ghost' : 'solid'}
              leftIcon={<Plus size={14} />}
              isDisabled={role === 'readonly'}
              onClick={() => { setActiveSessionId(null); setView('import'); }}
            >
              新建合并任务
            </Button>
            {openCount ? <Badge colorScheme="orange" fontSize="11px" px={2} py={1}>{openCount} 个任务未完成</Badge> : null}
          </Flex>
        </ModalHeader>

        <ModalBody px={{ base: 3, lg: 5 }} py={4}>
          <Box display="grid" gridTemplateColumns={{ base: '1fr', xl: '280px minmax(0,1fr)' }} gap={4}>
            <Box as="aside">
              <Box borderWidth="1px" borderColor="whiteAlpha.100" borderRadius="xl" bg="whiteAlpha.50" p={3}>
                <Text fontSize="xs" color="whiteAlpha.600" fontWeight="700" mb={2}>合并任务（自动保存在本机）</Text>
                {sessions.length === 0 ? (
                  <Text fontSize="xs" color="whiteAlpha.500" p={2}>暂无任务。导入两份离线草稿即可开始；关闭页面后任务仍在，可继续处理。</Text>
                ) : (
                  <VStack align="stretch" spacing={2}>
                    {sessions.map((session) => {
                      const stats = sessionStats(session);
                      const selected = session.id === activeSessionId && view === 'list';
                      return (
                        <Box
                          key={session.id}
                          as="button"
                          textAlign="left"
                          p={2.5}
                          borderRadius="lg"
                          borderWidth="1px"
                          borderColor={selected ? 'amber.400' : 'transparent'}
                          bg={selected ? 'amber.900' : 'blackAlpha.300'}
                          _hover={{ bg: selected ? 'amber.900' : 'whiteAlpha.100' }}
                          onClick={() => { setActiveSessionId(session.id); setView('list'); }}
                          aria-label={`合并任务 ${session.basePlanName}，${session.status === 'completed' ? '已完成' : `${stats.pendingFields + stats.pendingFreezes} 项待处理`}`}
                        >
                          <Flex align="center" gap={2}>
                            <Text fontSize="xs" fontWeight="700" noOfLines={1} flex="1">{session.basePlanName}</Text>
                            {session.status === 'completed' ? <CheckCircle2 size={14} color="#68d391" /> : <AlertTriangle size={14} color="#f6ad55" />}
                          </Flex>
                          <Text fontSize="10px" color="whiteAlpha.500" mt={1}>
                            {stats.scenes} 场 · {stats.entries} 提示
                          </Text>
                          {session.status === 'open' ? (
                            <Flex mt={1.5} align="center" gap={1}>
                              {stats.pendingFields ? <Tag size="sm" colorScheme="orange">{stats.pendingFields} 字段</Tag> : null}
                              {stats.pendingFreezes ? <Tag size="sm" colorScheme="red">{stats.pendingFreezes} 冻结</Tag> : null}
                              {stats.resolved ? <Tag size="sm" colorScheme="green">待生成</Tag> : null}
                              <Spacer />
                              <Tooltip label="删除任务（不影响原方案与已生成的合并方案）">
                                <IconButton
                                  aria-label="删除合并任务"
                                  icon={<Trash2 size={12} />}
                                  size="xs"
                                  variant="ghost"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (window.confirm('删除该合并任务？已做出的候选选择会一并清除。')) {
                                      onRemove(session.id);
                                      if (activeSessionId === session.id) setActiveSessionId(null);
                                    }
                                  }}
                                />
                              </Tooltip>
                            </Flex>
                          ) : (
                            <Tag size="sm" colorScheme="green" mt={1}>已生成方案</Tag>
                          )}
                        </Box>
                      );
                    })}
                  </VStack>
                )}
                <Divider my={3} />
                <Text fontSize="10px" color="whiteAlpha.500" lineHeight="1.7">
                  合并任务与原方案都保存在浏览器本地。任务未完成时重开页面可继续；原主控方案在合并全程保持只读，只有点击「生成合并方案」后才会出现新方案。
                </Text>
              </Box>
            </Box>

            <Box minW={0} className="scroll-region">
              {view === 'import' || (!activeSession && sessions.length === 0) ? (
                <ImportView
                  plans={plans}
                  role={role}
                  onCreate={create}
                />
              ) : activeSession ? (
                <SessionView
                  session={activeSession}
                  role={role}
                  onField={(blockId, entryKey, fieldId, choice) => onFieldChoice(activeSession.id, blockId, entryKey, fieldId, choice)}
                  onFreeze={(blockId, choice) => onFreezeChoice(activeSession.id, blockId, choice)}
                  onFinish={() => finish(activeSession)}
                  onOpenPlan={(planId) => { onOpenPlan(planId); onClose(); }}
                />
              ) : (
                <Flex minH="300px" align="center" justify="center" color="whiteAlpha.500">
                  <VStack>
                    <GitMerge size={34} />
                    <Text>从左侧选择一个合并任务继续处理，或新建任务。</Text>
                  </VStack>
                </Flex>
              )}
            </Box>
          </Box>
        </ModalBody>
        <ModalFooter borderTopWidth="1px" borderColor="whiteAlpha.100">
          <Flex align="center" gap={3} w="full">
            <Text fontSize="11px" color="whiteAlpha.500">
              {'权限：编程执行可提交参数草稿，但任何冻结状态改动都会被挡下并留在待处理清单，直到灯光设计或舞台监督拍板。'}
            </Text>
            <Spacer />
            <Button variant="ghost" size="sm" onClick={onClose}>返回设计台</Button>
          </Flex>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
