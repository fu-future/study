import type { Curriculum, Subject } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/** 学科与课程体系的数据访问层。 */

export async function listSubjects(): Promise<Subject[]> {
  return prisma.subject.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
}

export async function findSubjectByCode(code: string): Promise<Subject | null> {
  return prisma.subject.findUnique({ where: { code } });
}

export async function findSubjectById(id: string): Promise<Subject | null> {
  return prisma.subject.findUnique({ where: { id } });
}

/**
 * 同时接受「主键 id」与「学科代码」的解析器。
 *
 * 为什么需要它：前端与 API 在有些地方传的是 code（math），有些地方传的是 id，
 * 而 Conversation.subjectId / Question.subjectId 是**外键**，必须是真的 id。
 * 早期版本直接把 code 写进外键，导致 `Foreign key constraint violated`。
 * 统一在这里归一化，避免每个调用点各自处理。
 */
export async function resolveSubjectByIdentifier(identifier: string): Promise<Subject | null> {
  const byId = await prisma.subject.findUnique({ where: { id: identifier } });
  if (byId) return byId;
  // 兜底按 code 查（code 有唯一约束，不会歧义）
  return prisma.subject.findUnique({ where: { code: identifier } });
}

/** 批量取学科名映射，避免列表页 N+1 查询。 */
export async function getSubjectNameMap(): Promise<Map<string, string>> {
  const subjects = await prisma.subject.findMany({ select: { id: true, name: true, code: true } });
  const map = new Map<string, string>();
  for (const subject of subjects) {
    map.set(subject.id, subject.name);
    map.set(subject.code, subject.name);
  }
  return map;
}

export async function listSubjectsByIds(ids: string[]): Promise<Subject[]> {
  if (ids.length === 0) return [];
  return prisma.subject.findMany({ where: { id: { in: ids } } });
}

export async function upsertSubject(input: {
  code: string;
  name: string;
  isElective?: boolean;
  sortOrder?: number;
}): Promise<Subject> {
  return prisma.subject.upsert({
    where: { code: input.code },
    update: { name: input.name, isElective: input.isElective ?? false, sortOrder: input.sortOrder ?? 0 },
    create: {
      code: input.code,
      name: input.name,
      isElective: input.isElective ?? false,
      sortOrder: input.sortOrder ?? 0,
    },
  });
}

export async function listCurriculums(subjectId?: string): Promise<Curriculum[]> {
  return prisma.curriculum.findMany({
    where: subjectId ? { subjectId } : undefined,
    orderBy: [{ grade: 'asc' }, { name: 'asc' }],
  });
}

export async function findCurriculumById(id: string): Promise<Curriculum | null> {
  return prisma.curriculum.findUnique({ where: { id } });
}

export async function upsertCurriculum(input: {
  subjectId: string;
  name: string;
  grade?: string | null;
  region?: string | null;
  publisher?: string | null;
  description?: string | null;
  isApproved?: boolean;
  sourceNote?: string | null;
}): Promise<Curriculum> {
  const grade = input.grade ?? null;

  // 刻意不用 Prisma 的复合唯一 upsert：`grade` 是可空字段，
  // 复合唯一输入类型在可空字段上的约束在不同 Prisma 版本间存在差异，
  // 这里用 findFirst + create/update 显式表达，行为更可预期、也更好读。
  const existing = await prisma.curriculum.findFirst({
    where: { subjectId: input.subjectId, name: input.name, grade },
  });

  const payload = {
    region: input.region ?? null,
    publisher: input.publisher ?? null,
    description: input.description ?? null,
    isApproved: input.isApproved ?? false,
    sourceNote: input.sourceNote ?? null,
  };

  if (existing) {
    return prisma.curriculum.update({ where: { id: existing.id }, data: payload });
  }

  return prisma.curriculum.create({
    data: { subjectId: input.subjectId, name: input.name, grade, ...payload },
  });
}
