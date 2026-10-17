import type { KnowledgePoint, KnowledgePointRelation, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { containsFilter } from '@/lib/db/search';

/**
 * 知识点体系的数据访问层。
 *
 * 知识点是「可维护的课程目录」，不是 AI 自由发挥的产物：
 *   - 每条都有稳定 code，导入时按 code 幂等 upsert
 *   - reviewStatus 区分「已审核」与「AI 草稿」
 *   - 树形结构用 parentId + chapterPath 双重表达；关联用 KnowledgePointRelation
 */

export type KnowledgePointFilter = {
  subjectId?: string;
  grade?: string;
  chapter?: string;
  reviewStatus?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export async function listKnowledgePoints(filter: KnowledgePointFilter = {}): Promise<{
  items: KnowledgePoint[];
  total: number;
}> {
  const where: Prisma.KnowledgePointWhereInput = {};
  if (filter.subjectId) where.subjectId = filter.subjectId;
  if (filter.grade) where.grade = filter.grade;
  if (filter.chapter) where.chapter = filter.chapter;
  if (filter.reviewStatus) where.reviewStatus = filter.reviewStatus;
  if (filter.search) {
    const like = containsFilter(filter.search);
    where.OR = [{ name: like }, { chapterPath: like }, { description: like }, { code: like }];
  }

  const [items, total] = await Promise.all([
    prisma.knowledgePoint.findMany({
      where,
      orderBy: [{ subjectId: 'asc' }, { depth: 'asc' }, { chapterPath: 'asc' }, { name: 'asc' }],
      take: filter.limit ?? 200,
      skip: filter.offset ?? 0,
    }),
    prisma.knowledgePoint.count({ where }),
  ]);

  return { items, total };
}

export async function findKnowledgePointById(id: string): Promise<KnowledgePoint | null> {
  return prisma.knowledgePoint.findUnique({ where: { id } });
}

export async function findKnowledgePointsByIds(ids: string[]): Promise<KnowledgePoint[]> {
  if (ids.length === 0) return [];
  return prisma.knowledgePoint.findMany({ where: { id: { in: ids } } });
}

export async function findKnowledgePointByCode(code: string): Promise<KnowledgePoint | null> {
  return prisma.knowledgePoint.findUnique({ where: { code } });
}

/** 树形结构：返回同一学科/年级下的全部节点，由上层组装成树（纯函数，可测试）。 */
export async function listKnowledgePointsForTree(input: {
  subjectId: string;
  grade?: string;
}): Promise<KnowledgePoint[]> {
  return prisma.knowledgePoint.findMany({
    where: { subjectId: input.subjectId, ...(input.grade ? { grade: input.grade } : {}) },
    orderBy: [{ depth: 'asc' }, { chapterPath: 'asc' }, { name: 'asc' }],
  });
}

// -----------------------------------------------------------------------------
// 有向关联（前置 / 后续知识）
// -----------------------------------------------------------------------------

export async function listRelations(input: {
  fromIds?: string[];
  toIds?: string[];
  relationType?: string;
}): Promise<KnowledgePointRelation[]> {
  const where: Prisma.KnowledgePointRelationWhereInput = {};
  if (input.fromIds) where.fromId = { in: input.fromIds };
  if (input.toIds) where.toId = { in: input.toIds };
  if (input.relationType) where.relationType = input.relationType;
  return prisma.knowledgePointRelation.findMany({ where });
}

/** 直接前置知识（1 跳）。传递闭包由 src/lib/knowledge/graph.ts 计算。 */
export async function listPrerequisiteEdges(knowledgePointIds: string[]): Promise<KnowledgePointRelation[]> {
  if (knowledgePointIds.length === 0) return [];
  return prisma.knowledgePointRelation.findMany({
    where: { toId: { in: knowledgePointIds }, relationType: 'prerequisite' },
  });
}

export async function upsertRelation(input: {
  fromId: string;
  toId: string;
  relationType: string;
  strength?: number;
  note?: string | null;
  source?: string;
}): Promise<KnowledgePointRelation> {
  return prisma.knowledgePointRelation.upsert({
    where: {
      fromId_toId_relationType: {
        fromId: input.fromId,
        toId: input.toId,
        relationType: input.relationType,
      },
    },
    update: {
      strength: input.strength ?? 3,
      note: input.note ?? null,
      source: input.source ?? 'manual',
    },
    create: {
      fromId: input.fromId,
      toId: input.toId,
      relationType: input.relationType,
      strength: input.strength ?? 3,
      note: input.note ?? null,
      source: input.source ?? 'manual',
    },
  });
}

// -----------------------------------------------------------------------------
// 写入 / 导入
// -----------------------------------------------------------------------------

export type KnowledgePointUpsertInput = {
  code: string;
  name: string;
  subjectId: string;
  grade: string;
  curriculumId?: string | null;
  chapter: string;
  chapterPath: string;
  parentCode?: string | null;
  description?: string | null;
  difficulty?: number;
  commonMistakes?: string[];
  typicalQuestionTypes?: string[];
  reviewStatus?: string;
  source?: string;
  sourceNote?: string | null;
};

/**
 * 按 code 幂等写入知识点。
 * parentCode 需要二次解析（父节点可能在同一批导入中稍后才出现），
 * 因此调用方应先写完所有节点，再调用 resolveParents()。
 */
export async function upsertKnowledgePoint(input: KnowledgePointUpsertInput): Promise<KnowledgePoint> {
  const commonMistakes = JSON.stringify(input.commonMistakes ?? []);
  const typicalQuestionTypes = JSON.stringify(input.typicalQuestionTypes ?? []);

  return prisma.knowledgePoint.upsert({
    where: { code: input.code },
    update: {
      name: input.name,
      subjectId: input.subjectId,
      grade: input.grade,
      curriculumId: input.curriculumId ?? null,
      chapter: input.chapter,
      chapterPath: input.chapterPath,
      description: input.description ?? null,
      difficulty: input.difficulty ?? 3,
      commonMistakes,
      typicalQuestionTypes,
      reviewStatus: input.reviewStatus ?? 'draft',
      source: input.source ?? 'csv-import',
      sourceNote: input.sourceNote ?? null,
    },
    create: {
      code: input.code,
      name: input.name,
      subjectId: input.subjectId,
      grade: input.grade,
      curriculumId: input.curriculumId ?? null,
      chapter: input.chapter,
      chapterPath: input.chapterPath,
      description: input.description ?? null,
      difficulty: input.difficulty ?? 3,
      commonMistakes,
      typicalQuestionTypes,
      reviewStatus: input.reviewStatus ?? 'draft',
      source: input.source ?? 'csv-import',
      sourceNote: input.sourceNote ?? null,
    },
  });
}

/** 批量写入 + 解析 parentCode → parentId + 计算 depth。返回 code → id 映射。 */
export async function importKnowledgePoints(
  rows: KnowledgePointUpsertInput[],
): Promise<{ codeToId: Map<string, string>; count: number }> {
  const codeToId = new Map<string, string>();

  for (const row of rows) {
    const saved = await upsertKnowledgePoint(row);
    codeToId.set(row.code, saved.id);
  }

  // 第二遍：解析父子关系与深度
  for (const row of rows) {
    const id = codeToId.get(row.code);
    if (!id) continue;

    const parentId = row.parentCode ? (codeToId.get(row.parentCode) ?? null) : null;
    // 深度直接由章节路径推导（"函数与导数/导数/导数运算" → 2），
    // 这样即使 parentCode 缺失也能得到一致的层级。
    const depth = Math.max(0, row.chapterPath.split('/').filter(Boolean).length - 1);

    await prisma.knowledgePoint.update({
      where: { id },
      data: { parentId, depth },
    });
  }

  return { codeToId, count: rows.length };
}

/** 知识点被引用的情况 —— 删除/归档前的安全检查用。 */
export async function getKnowledgePointUsage(id: string): Promise<{
  questions: number;
  masteries: number;
  tasks: number;
  resources: number;
}> {
  const [questions, masteries, tasks, resources] = await Promise.all([
    prisma.questionKnowledgePoint.count({ where: { knowledgePointId: id } }),
    prisma.userKnowledgeMastery.count({ where: { knowledgePointId: id } }),
    prisma.studyTask.count({ where: { knowledgePointId: id } }),
    prisma.resourceKnowledgePoint.count({ where: { knowledgePointId: id } }),
  ]);
  return { questions, masteries, tasks, resources };
}
