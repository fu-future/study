import type { LearningResource, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { containsFilter } from '@/lib/db/search';

/**
 * 学习资源的数据访问层。
 *
 * 核心原则（来自需求）：
 *   1. 「已验证的资源」与「未经核验的搜索结果」必须明确区分 —— 靠 verificationStatus
 *   2. 不编造视频标题、链接、时长、平台 —— 拿不到的可空字段就留空，绝不用假数据填充
 *   3. 资源缺失时给出降级方案（系统内部讲解 + 练习），而不是伪造一条推荐
 */

export type ResourceFilter = {
  knowledgePointId?: string;
  subjectId?: string;
  resourceType?: string;
  verificationStatus?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export async function listResources(filter: ResourceFilter = {}): Promise<{
  items: LearningResource[];
  total: number;
}> {
  const where: Prisma.LearningResourceWhereInput = { status: { not: 'unavailable' } };

  if (filter.subjectId) where.subjectId = filter.subjectId;
  if (filter.resourceType) where.resourceType = filter.resourceType;
  if (filter.verificationStatus) where.verificationStatus = filter.verificationStatus;
  if (filter.knowledgePointId) {
    where.knowledgePointLinks = { some: { knowledgePointId: filter.knowledgePointId } };
  }
  if (filter.search) {
    const like = containsFilter(filter.search);
    where.OR = [{ title: like }, { platform: like }, { description: like }];
  }

  const [items, total] = await Promise.all([
    prisma.learningResource.findMany({
      where,
      orderBy: [{ verificationStatus: 'asc' }, { updatedAt: 'desc' }],
      take: filter.limit ?? 50,
      skip: filter.offset ?? 0,
    }),
    prisma.learningResource.count({ where }),
  ]);

  return { items, total };
}

/** 某个知识点下的资源，按核验状态优先（已验证在前）与相关度排序。 */
export async function listResourcesForKnowledgePoint(knowledgePointId: string) {
  return prisma.learningResource.findMany({
    where: {
      status: { not: 'unavailable' },
      knowledgePointLinks: { some: { knowledgePointId } },
    },
    include: { knowledgePointLinks: { where: { knowledgePointId } } },
    orderBy: [{ verificationStatus: 'asc' }, { resourceType: 'asc' }],
  });
}

export async function findResourceById(id: string): Promise<LearningResource | null> {
  return prisma.learningResource.findUnique({ where: { id } });
}

export async function createResource(input: {
  title: string;
  resourceType: string;
  provider: string;
  platform?: string | null;
  url: string;
  verificationStatus?: string;
  verifiedBy?: string | null;
  subjectId?: string | null;
  grade?: string | null;
  difficulty?: number | null;
  durationSeconds?: number | null;
  description?: string | null;
  content?: string | null;
  createdBy?: string;
}): Promise<LearningResource> {
  return prisma.learningResource.create({
    data: {
      title: input.title,
      resourceType: input.resourceType,
      provider: input.provider,
      platform: input.platform ?? null,
      url: input.url,
      verificationStatus: input.verificationStatus ?? 'unverified',
      // 只有标记为 verified 时才写核验时间，避免「未核验却有核验时间」的假象
      lastVerifiedAt: input.verificationStatus === 'verified' ? new Date() : null,
      verifiedBy: input.verifiedBy ?? null,
      subjectId: input.subjectId ?? null,
      grade: input.grade ?? null,
      difficulty: input.difficulty ?? null,
      durationSeconds: input.durationSeconds ?? null,
      description: input.description ?? null,
      content: input.content ?? null,
      createdBy: input.createdBy ?? 'admin',
    },
  });
}

export async function updateResource(
  id: string,
  patch: {
    title?: string;
    resourceType?: string;
    url?: string;
    platform?: string | null;
    description?: string | null;
    content?: string | null;
    verificationStatus?: string;
    verifiedBy?: string | null;
    status?: string;
    durationSeconds?: number | null;
    difficulty?: number | null;
  },
): Promise<LearningResource> {
  return prisma.learningResource.update({
    where: { id },
    data: {
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.resourceType === undefined ? {} : { resourceType: patch.resourceType }),
      ...(patch.url === undefined ? {} : { url: patch.url }),
      ...(patch.platform === undefined ? {} : { platform: patch.platform }),
      ...(patch.description === undefined ? {} : { description: patch.description }),
      ...(patch.content === undefined ? {} : { content: patch.content }),
      ...(patch.verificationStatus === undefined
        ? {}
        : {
            verificationStatus: patch.verificationStatus,
            // 状态切到 verified 就记核验时间；切回 unverified 就清掉，不留下误导性时间戳
            lastVerifiedAt: patch.verificationStatus === 'verified' ? new Date() : null,
          }),
      ...(patch.verifiedBy === undefined ? {} : { verifiedBy: patch.verifiedBy }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.durationSeconds === undefined ? {} : { durationSeconds: patch.durationSeconds }),
      ...(patch.difficulty === undefined ? {} : { difficulty: patch.difficulty }),
    },
  });
}

export async function linkResourceToKnowledgePoint(input: {
  resourceId: string;
  knowledgePointId: string;
  relevance?: number;
  matchSource?: string;
}): Promise<void> {
  await prisma.resourceKnowledgePoint.upsert({
    where: {
      resourceId_knowledgePointId: {
        resourceId: input.resourceId,
        knowledgePointId: input.knowledgePointId,
      },
    },
    update: { relevance: input.relevance ?? 1, matchSource: input.matchSource ?? 'manual' },
    create: {
      resourceId: input.resourceId,
      knowledgePointId: input.knowledgePointId,
      relevance: input.relevance ?? 1,
      matchSource: input.matchSource ?? 'manual',
    },
  });
}

/**
 * 外部搜索结果的去重检查：同一个 URL 不重复入库。
 * 返回已存在的资源，便于把「未核验的外部结果」和「库内已有资源」合并展示。
 */
export async function findResourceByUrl(url: string): Promise<LearningResource | null> {
  return prisma.learningResource.findFirst({ where: { url } });
}

export async function countResourcesByVerification(): Promise<Record<string, number>> {
  const grouped = await prisma.learningResource.groupBy({
    by: ['verificationStatus'],
    _count: { _all: true },
  });
  const result: Record<string, number> = {};
  for (const row of grouped) result[row.verificationStatus] = row._count._all;
  return result;
}
