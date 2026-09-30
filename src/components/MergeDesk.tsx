import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  HStack,
  Heading,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Radio,
  RadioGroup,
  SimpleGrid,
  Spacer,
  Spinner,
  Tag,
  Text,
  useToast,
  VStack
} from '@chakra-ui/react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileJson,
  GitMerge,
  Lock,
  ShieldAlert,
  Upload,
  XCircle
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { roleLabels } from '../data';
import {
  deleteMergeTask,
  fieldLabel,
  formatFieldValue,
  generateMergedPlan,
  loadMergeTasks,
  parseDraftFile,
  recomputeAnalysis,
  upsertMergeTask,
  type MergeConflict,
  type MergeDraftId,
  type MergeTask
} from '../merge';
import type { LightingPlan } from '../types';

interface MergeDeskProps {
  isOpen: boolean;
  onClose: () => void;
  basePlan: LightingPlan | undefined;
  onMerged: (plan: LightingPlan) => void;
  initialTask?: MergeTask | null;
}

type Step = 'drafts' | 'resolve' | 'done';

const draftMeta: Record<MergeDraftId, { label: string; color: string; hint: string }> = {
  A: { label: '草稿甲', color: 'blue', hint: '灯光设计离线稿' },
  B: { label: '草稿乙', color: 'purple', hint: '编程执行离线稿' }
};

function planSummary(plan: LightingPlan | undefined) {
  if (!plan) return null;
  const sceneCount = plan.scenes.length;
  const cueCount = plan.scenes.reduce((sum, scene) => sum + scene.cues.length, 0);
  return { sceneCount, cueCount };
}

export default function MergeDesk({ isOpen, onClose, basePlan, onMerged, initialTask }: MergeDeskProps) {
  const [task, setTask] = useState<MergeTask | null>(null);
  const [step, setStep] = useState<Step>('drafts');
  const [loading, setLoading] = useState<MergeDraftId | null>(null);
  const [error, setError] = useState('');
  const [generatedPlan, setGeneratedPlan] = useState<LightingPlan | null>(null);
  const fileInputA = useRef<HTMLInputElement>(null);
  const fileInputB = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (isOpen) {
      setError('');
      setGeneratedPlan(null);
      if (initialTask) {
        setTask(initialTask);
        setStep(initialTask.status === 'completed' ? 'done' : 'resolve');
      } else if (basePlan) {
        setTask({
          id: `merge-${Date.now().toString(36)}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          basePlanId: basePlan.id,
          basePlanName: basePlan.name,
          draftALabel: '',
          draftBLabel: '',
          status: 'in-progress',
          basePlan: structuredClone(basePlan),
          draftA: structuredClone(basePlan),
          draftB: structuredClone(basePlan),
          conflicts: [],
          blocked: [],
          addedCues: [],
          autoChanges: []
        });
        setStep('drafts');
      }
    }
  }, [isOpen, basePlan, initialTask]);

  const stats = useMemo(() => {
    if (!task) return null;
    return {
      conflictCount: task.conflicts.length,
      blockedCount: task.blocked.length,
      addedCount: task.addedCues.length,
      autoCount: task.autoChanges.length,
      unresolvedCount: task.conflicts.filter((conflict) => conflict.chosen === 'original').length
    };
  }, [task]);

  if (!task) return null;

  const baseSummary = planSummary(task.basePlan);
  const aSummary = planSummary(task.draftA);
  const bSummary = planSummary(task.draftB);
  const bothDraftsLoaded = task.draftALabel !== '' && task.draftBLabel !== '';

  async function handleFile(which: MergeDraftId, file: File | undefined) {
    if (!file) return;
    setLoading(which);
    setError('');
    try {
      const parsed = await parseDraftFile(file);
      setTask((current) => {
        if (!current) return current;
        const next: MergeTask = {
          ...current,
          [which === 'A' ? 'draftA' : 'draftB']: parsed.plan,
          [which === 'A' ? 'draftALabel' : 'draftBLabel']: parsed.label,
          [which === 'A' ? 'draftARole' : 'draftBRole']: parsed.role
        };
        return recomputeAnalysis(next);
      });
      toast({ title: `${draftMeta[which].label} 已载入`, description: parsed.label, status: 'success', duration: 1600 });
    } catch (err) {
      setError(err instanceof Error ? err.message : '草稿解析失败');
    } finally {
      setLoading(null);
    }
  }

  function updateChoice(conflictId: string, chosen: 'original' | MergeDraftId) {
    setTask((current) => {
      if (!current) return current;
      const next: MergeTask = {
        ...current,
        conflicts: current.conflicts.map((conflict) =>
          conflict.id === conflictId ? { ...conflict, chosen } : conflict
        )
      };
      upsertMergeTask(next);
      return next;
    });
  }

  function persistTask() {
    if (!task) return;
    upsertMergeTask(task);
  }

  function goResolve() {
    if (!bothDraftsLoaded) {
      setError('请先载入两份离线草稿');
      return;
    }
    persistTask();
    setStep('resolve');
  }

  function generate() {
    if (!task) return;
    const merged = generateMergedPlan(task);
    setGeneratedPlan(merged);
    const completed: MergeTask = {
      ...task,
      status: 'completed',
      mergedPlanId: merged.id,
      mergedPlanName: merged.name,
      completedAt: new Date().toISOString()
    };
    upsertMergeTask(completed);
    setTask(completed);
    setStep('done');
    toast({ title: '合并方案已生成', status: 'success', duration: 2000 });
  }

  function finish() {
    if (generatedPlan) onMerged(generatedPlan);
    onClose();
  }

  function discard() {
    if (task && task.status !== 'completed') {
      deleteMergeTask(task.id);
    }
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="6xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent bg="stage.900" borderWidth="1px" borderColor="whiteAlpha.100" maxH="88vh">
        <ModalHeader borderBottomWidth="1px" borderColor="whiteAlpha.100">
          <HStack gap={2}>
            <GitMerge size={20} color="#f6c453" />
            <Text>离线草稿合并台</Text>
            {stats && step !== 'drafts' ? (
              <Tag size="sm" colorScheme="blue" ml={2}>
                {stats.conflictCount} 项待选定 · {stats.blockedCount} 项越权拦截
              </Tag>
            ) : null}
          </HStack>
        </ModalHeader>
        <ModalCloseButton />

        <ModalBody py={5}>
          {error ? (
            <Alert status="error" borderRadius="lg" mb={4}>
              <AlertIcon />
              <AlertDescription fontSize="sm">{error}</AlertDescription>
            </Alert>
          ) : null}

          {step === 'drafts' ? (
            <VStack align="stretch" spacing={5}>
              <Alert status="info" borderRadius="lg">
                <AlertIcon />
                <AlertDescription fontSize="sm">
                  载入灯光设计与编程执行分别导出的离线草稿。系统按场次顺序、提示编号与灯位对齐：不同提示直接并入，同一提示的通道、亮度、渐变或跟随目标有两套新值时保留原值与双方候选，由你选定后再生成合并方案。
                </AlertDescription>
              </Alert>

              <Box borderWidth="1px" borderColor="whiteAlpha.100" borderRadius="xl" p={4} bg="blackAlpha.200">
                <HStack mb={3}>
                  <FileJson size={16} color="#9ae6b4" />
                  <Text fontWeight="700" fontSize="sm">原稿（当前方案，不参与修改）</Text>
                  <Spacer />
                  <Tag size="sm" colorScheme="green">{task.basePlanName}</Tag>
                </HStack>
                {baseSummary ? (
                  <Text color="whiteAlpha.500" fontSize="xs">
                    {baseSummary.sceneCount} 个场次 · {baseSummary.cueCount} 条提示
                  </Text>
                ) : null}
              </Box>

              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                {(['A', 'B'] as MergeDraftId[]).map((which) => {
                  const meta = draftMeta[which];
                  const loaded = which === 'A' ? task.draftALabel : task.draftBLabel;
                  const summary = which === 'A' ? aSummary : bSummary;
                  const role = which === 'A' ? task.draftARole : task.draftBRole;
                  const inputRef = which === 'A' ? fileInputA : fileInputB;
                  return (
                    <Box
                      key={which}
                      borderWidth="1px"
                      borderColor={loaded ? `${meta.color}.500` : 'whiteAlpha.200'}
                      borderRadius="xl"
                      p={4}
                      bg="blackAlpha.200"
                    >
                      <HStack mb={3}>
                        <Tag size="sm" colorScheme={meta.color}>{meta.label}</Tag>
                        <Text fontWeight="700" fontSize="sm">{meta.hint}</Text>
                        <Spacer />
                        {loading === which ? <Spinner size="sm" /> : null}
                      </HStack>
                      {loaded ? (
                        <VStack align="stretch" spacing={2}>
                          <HStack>
                            <CheckCircle2 size={15} color="#9ae6b4" />
                            <Text fontSize="sm" noOfLines={1}>{loaded}</Text>
                          </HStack>
                          {summary ? (
                            <Text color="whiteAlpha.500" fontSize="xs">
                              {summary.sceneCount} 个场次 · {summary.cueCount} 条提示
                              {role ? ` · ${roleLabels[role]}` : ''}
                            </Text>
                          ) : null}
                          <Button size="xs" variant="ghost" leftIcon={<Upload size={13} />} onClick={() => inputRef.current?.click()}>
                            重新载入
                          </Button>
                        </VStack>
                      ) : (
                        <VStack align="stretch" spacing={2}>
                          <Text color="whiteAlpha.500" fontSize="xs">尚未载入草稿</Text>
                          <Button size="sm" variant="outline" leftIcon={<Upload size={15} />} onClick={() => inputRef.current?.click()}>
                            选择 {meta.label} JSON
                          </Button>
                        </VStack>
                      )}
                      <Input
                        ref={inputRef}
                        type="file"
                        accept="application/json,.json"
                        display="none"
                        onChange={(event) => void handleFile(which, event.target.files?.[0])}
                      />
                    </Box>
                  );
                })}
              </SimpleGrid>

              {bothDraftsLoaded && stats ? (
                <Box borderWidth="1px" borderColor="whiteAlpha.100" borderRadius="xl" p={4} bg="whiteAlpha.50">
                  <HStack mb={3}>
                    <Text fontWeight="700" fontSize="sm">对齐预览</Text>
                    <Spacer />
                    <Tag size="sm" colorScheme="blue">{stats.conflictCount} 项待选定</Tag>
                    <Tag size="sm" colorScheme="orange">{stats.blockedCount} 项越权拦截</Tag>
                    <Tag size="sm" colorScheme="green">{stats.addedCount} 条新提示并入</Tag>
                  </HStack>
                  <SimpleGrid columns={{ base: 2, md: 4 }} spacing={2}>
                    <StatBox label="待选定冲突" value={stats.conflictCount} color="blue.300" />
                    <StatBox label="越权拦截" value={stats.blockedCount} color="orange.300" />
                    <StatBox label="新提示并入" value={stats.addedCount} color="green.300" />
                    <StatBox label="单方/一致修改" value={stats.autoCount} color="whiteAlpha.600" />
                  </SimpleGrid>
                </Box>
              ) : null}
            </VStack>
          ) : null}

          {step === 'resolve' && stats ? (
            <VStack align="stretch" spacing={5}>
              <SimpleGrid columns={{ base: 2, md: 4 }} spacing={2}>
                <StatBox label="待选定冲突" value={stats.conflictCount} color="blue.300" />
                <StatBox label="越权拦截" value={stats.blockedCount} color="orange.300" />
                <StatBox label="新提示并入" value={stats.addedCount} color="green.300" />
                <StatBox label="未选（按原值）" value={stats.unresolvedCount} color="whiteAlpha.600" />
              </SimpleGrid>

              {stats.blockedCount > 0 ? (
                <Box borderWidth="1px" borderColor="orange.700" borderRadius="xl" p={4} bg="orange.900">
                  <HStack mb={3}>
                    <ShieldAlert size={16} color="#f6ad55" />
                    <Text fontWeight="700" fontSize="sm">越权拦截（不并入合并方案，留在待处理清单）</Text>
                  </HStack>
                  <VStack align="stretch" spacing={2}>
                    {task.blocked.map((item) => (
                      <HStack key={item.id} align="start" gap={2}>
                        <Lock size={14} color="#f6ad55" style={{ marginTop: 3 }} />
                        <Box>
                          <Text fontSize="sm">{item.message}</Text>
                          <Text color="whiteAlpha.500" fontSize="xs">
                            {item.sceneName}
                            {item.cueNumber ? ` · ${item.cueNumber} ${item.cueLabel ?? ''}` : ''}
                          </Text>
                        </Box>
                      </HStack>
                    ))}
                  </VStack>
                </Box>
              ) : null}

              <Box>
                <HStack mb={3}>
                  <Text fontWeight="700" fontSize="sm">待选定冲突</Text>
                  <Spacer />
                  <Text color="whiteAlpha.500" fontSize="xs">未选择时保留原值</Text>
                </HStack>
                {task.conflicts.length === 0 ? (
                  <Alert status="success" borderRadius="lg">
                    <AlertIcon />
                    <AlertDescription fontSize="sm">没有需要选定的冲突，可直接生成合并方案。</AlertDescription>
                  </Alert>
                ) : (
                  <VStack align="stretch" spacing={3}>
                    {task.conflicts.map((conflict) => (
                      <ConflictRow
                        key={conflict.id}
                        conflict={conflict}
                        basePlan={task.basePlan}
                        draftA={task.draftA}
                        draftB={task.draftB}
                        blocked={task.blocked}
                        onChange={(chosen) => updateChoice(conflict.id, chosen)}
                      />
                    ))}
                  </VStack>
                )}
              </Box>

              {stats.addedCount > 0 || stats.autoCount > 0 ? (
                <Box>
                  <HStack mb={3}>
                    <Text fontWeight="700" fontSize="sm">并入预览</Text>
                    <Spacer />
                    <Text color="whiteAlpha.500" fontSize="xs">不同提示直接并入，一致修改自动采用</Text>
                  </HStack>
                  <VStack align="stretch" spacing={2}>
                    {task.addedCues.map((added) => (
                      <HStack key={added.id} p={2} borderRadius="lg" bg="blackAlpha.200" fontSize="sm">
                        <Tag size="sm" colorScheme={added.draftId === 'A' ? 'blue' : 'purple'}>
                          {draftMeta[added.draftId].label}
                        </Tag>
                        <Text>{added.sceneName}</Text>
                        <Text color="amber.300" fontFamily="mono" fontSize="xs">{added.cueNumber}</Text>
                        <Text noOfLines={1}>{added.cueLabel}</Text>
                        <Spacer />
                        <Tag size="sm" colorScheme="green">并入</Tag>
                      </HStack>
                    ))}
                    {task.autoChanges.map((change) => (
                      <HStack key={change.id} p={2} borderRadius="lg" bg="blackAlpha.200" fontSize="sm">
                        <Tag size="sm" colorScheme={change.reason === 'agreed' ? 'green' : 'whiteAlpha'}>
                          {change.reason === 'agreed' ? '双方一致' : change.reason === 'single-A' ? '仅甲改' : '仅乙改'}
                        </Tag>
                        <Text color="amber.300" fontFamily="mono" fontSize="xs">{change.cueNumber}</Text>
                        <Text>{fieldLabel(change.field)}</Text>
                        <Spacer />
                        <Text fontFamily="mono" fontSize="xs" color="whiteAlpha.700">
                          {formatFieldValue(change.field, change.value, task.basePlan)}
                        </Text>
                      </HStack>
                    ))}
                  </VStack>
                </Box>
              ) : null}
            </VStack>
          ) : null}

          {step === 'done' && generatedPlan ? (
            <VStack align="stretch" spacing={5}>
              <Alert status="success" borderRadius="lg">
                <AlertIcon />
                <AlertDescription fontSize="sm">
                  合并方案「{generatedPlan.name}」已生成。全剧时间、跟随顺序与通道冲突已重新计算，原稿继续保留可查。
                </AlertDescription>
              </Alert>
              <SimpleGrid columns={{ base: 2, md: 4 }} spacing={2}>
                <StatBox label="合并场次" value={generatedPlan.scenes.length} color="blue.300" />
                <StatBox label="合并提示" value={generatedPlan.scenes.reduce((sum, s) => sum + s.cues.length, 0)} color="purple.300" />
                <StatBox label="全剧时长" value={`${Math.round(generatedPlan.scenes.reduce((sum, s) => sum + (s.duration ?? 0), 0))}s`} color="amber.300" />
                <StatBox label="越权拦截" value={task.blocked.length} color="orange.300" />
              </SimpleGrid>
              <Box borderWidth="1px" borderColor="whiteAlpha.100" borderRadius="xl" p={4} bg="blackAlpha.200">
                <Text fontWeight="700" fontSize="sm" mb={3}>场次时间轴</Text>
                <VStack align="stretch" spacing={2}>
                  {generatedPlan.scenes.map((scene) => (
                    <HStack key={scene.id} fontSize="sm">
                      <Text color="amber.300" fontFamily="mono" fontSize="xs" w="32px">{scene.order.toString().padStart(2, '0')}</Text>
                      <Text flex="1" noOfLines={1}>{scene.name}</Text>
                      <Text color="whiteAlpha.500" fontSize="xs">{scene.cues.length} 条</Text>
                      <Text color="whiteAlpha.500" fontSize="xs">{Math.round(scene.duration ?? 0)}s</Text>
                    </HStack>
                  ))}
                </VStack>
              </Box>
            </VStack>
          ) : null}
        </ModalBody>

        <ModalFooter borderTopWidth="1px" borderColor="whiteAlpha.100" gap={2}>
          {step === 'drafts' ? (
            <>
              <Button variant="ghost" onClick={discard}>取消</Button>
              <Spacer />
              <Button colorScheme="amber" rightIcon={<ArrowRight size={16} />} isDisabled={!bothDraftsLoaded} onClick={goResolve}>
                对齐并选定冲突
              </Button>
            </>
          ) : null}
          {step === 'resolve' ? (
            <>
              <Button variant="ghost" onClick={() => setStep('drafts')}>返回载入草稿</Button>
              <Spacer />
              <Button variant="ghost" leftIcon={<XCircle size={15} />} onClick={discard}>放弃任务</Button>
              <Button colorScheme="amber" leftIcon={<GitMerge size={16} />} onClick={generate}>
                生成合并方案
              </Button>
            </>
          ) : null}
          {step === 'done' ? (
            <>
              <Spacer />
              <Button colorScheme="amber" leftIcon={<CheckCircle2 size={16} />} onClick={finish}>
                在方案中查看
              </Button>
            </>
          ) : null}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function StatBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <Box p={3} borderRadius="lg" bg="blackAlpha.200">
      <Text fontSize="xl" fontWeight="800" color={color}>{value}</Text>
      <Text color="whiteAlpha.500" fontSize="xs">{label}</Text>
    </Box>
  );
}

function ConflictRow({
  conflict,
  basePlan,
  draftA,
  draftB,
  blocked,
  onChange
}: {
  conflict: MergeConflict;
  basePlan: LightingPlan;
  draftA: LightingPlan;
  draftB: LightingPlan;
  blocked: MergeTask['blocked'];
  onChange: (chosen: 'original' | MergeDraftId) => void;
}) {
  const aBlocked = blocked.some(
    (item) => item.draftId === 'A' && item.kind === 'frozen-cue-edit' && item.sceneOrder === conflict.sceneOrder && item.cueNumber === conflict.cueNumber
  );
  const bBlocked = blocked.some(
    (item) => item.draftId === 'B' && item.kind === 'frozen-cue-edit' && item.sceneOrder === conflict.sceneOrder && item.cueNumber === conflict.cueNumber
  );

  const options: { value: 'original' | MergeDraftId; label: string; sub: string; disabled: boolean; blocked?: boolean }[] = [
    {
      value: 'original',
      label: '原值',
      sub: formatFieldValue(conflict.field, conflict.original, basePlan),
      disabled: false
    },
    {
      value: 'A',
      label: draftMeta.A.label,
      sub: formatFieldValue(conflict.field, conflict.candidates.find((c) => c.draftId === 'A')?.value, draftA),
      disabled: aBlocked,
      blocked: aBlocked
    },
    {
      value: 'B',
      label: draftMeta.B.label,
      sub: formatFieldValue(conflict.field, conflict.candidates.find((c) => c.draftId === 'B')?.value, draftB),
      disabled: bBlocked,
      blocked: bBlocked
    }
  ];

  return (
    <Box borderWidth="1px" borderColor="whiteAlpha.100" borderRadius="xl" p={4} bg="blackAlpha.200">
      <HStack mb={3}>
        <Text color="amber.300" fontFamily="mono" fontSize="xs">{conflict.cueNumber}</Text>
        <Text fontWeight="600" fontSize="sm">{conflict.cueLabel}</Text>
        <Spacer />
        <Tag size="sm" colorScheme="blue">{fieldLabel(conflict.field)}</Tag>
      </HStack>
      <RadioGroup value={conflict.chosen} onChange={(value) => onChange(value as 'original' | MergeDraftId)}>
        <Grid templateColumns={{ base: '1fr', md: '1fr 1fr 1fr' }} gap={2}>
          {options.map((option) => (
            <Box
              key={option.value}
              as="label"
              p={3}
              borderRadius="lg"
              borderWidth="1px"
              borderColor={conflict.chosen === option.value ? 'amber.400' : 'whiteAlpha.200'}
              bg={conflict.chosen === option.value ? 'amber.900' : 'whiteAlpha.50'}
              cursor={option.disabled ? 'not-allowed' : 'pointer'}
              opacity={option.disabled ? 0.5 : 1}
            >
              <HStack mb={1}>
                <Radio value={option.value} isDisabled={option.disabled} colorScheme="amber" />
                <Text fontSize="xs" color="whiteAlpha.600">{option.label}</Text>
                {option.blocked ? (
                  <Tag size="sm" colorScheme="orange" ml="auto">
                    <HStack spacing={1}><Lock size={10} /><Text>越权</Text></HStack>
                  </Tag>
                ) : null}
              </HStack>
              <Text fontFamily="mono" fontSize="sm" noOfLines={1}>{option.sub}</Text>
            </Box>
          ))}
        </Grid>
      </RadioGroup>
    </Box>
  );
}
