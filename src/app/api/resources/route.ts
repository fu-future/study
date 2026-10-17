import { withApiHandler, jsonOk, readJsonBody, readQuery } from '@/lib/api/http';
import { requireAdmin, requireUser } from '@/lib/auth/current-user';
import { resourceCreateSchema, resourceQuerySchema } from '@/lib/validation/schemas';
import {
  countResourcesByVerification,
  createResource,
  linkResourceToKnowledgePoint,
  listResources,
} from '@/lib/repositories/resources.repository';

/**
 * 学习资源库。
 *
 * 查询对所有人开放（资源是公共的），维护只允许管理员 ——
 * 资源库里的「已验证」标记是有分量的，不能被任何学生随手写入。
 */

export const GET = withApiHandler(async (request: Request) => {
  await requireUser();
  const query = resourceQuerySchema.parse(readQuery(request.url));

  const { items, total } = await listResources({
    knowledgePointId: query.knowledgePointId,
    subjectId: query.subjectId,
    resourceType: query.resourceType,
    verificationStatus: query.verificationStatus,
    search: query.search,
    limit: query.limit,
    offset: query.offset,
  });

  const counts = await countResourcesByVerification();

  return jsonOk({
    // Date 无法直接进 JSON，出库时统一转成 ISO 字符串
    items: items.map((item) => ({
      ...item,
      lastVerifiedAt: item.lastVerifiedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    total,
    verifiedCount: counts.verified ?? 0,
    unverifiedCount: counts.unverified ?? 0,
  });
});

export const POST = withApiHandler(async (request: Request) => {
  const admin = await requireAdmin();
  const body = resourceCreateSchema.parse(await readJsonBody(request));

  const resource = await createResource({
    title: body.title,
    resourceType: body.resourceType,
    provider: 'manual',
    platform: body.platform ?? null,
    url: body.url,
    // 只有管理员显式标记 verified 才写入核验状态与核验时间，不自动核验任何东西
    verificationStatus: body.verified ? 'verified' : 'unverified',
    verifiedBy: body.verified ? admin.id : null,
    subjectId: body.subjectId ?? null,
    grade: body.grade ?? null,
    difficulty: body.difficulty ?? null,
    durationSeconds: body.durationSeconds ?? null,
    description: body.description ?? null,
    content: body.content ?? null,
    createdBy: admin.id,
  });

  for (const knowledgePointId of body.knowledgePointIds ?? []) {
    await linkResourceToKnowledgePoint({
      resourceId: resource.id,
      knowledgePointId,
      matchSource: 'manual',
    });
  }

  return jsonOk({ id: resource.id });
});
