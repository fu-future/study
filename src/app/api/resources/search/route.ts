import { withApiHandler, jsonOk, readJsonBody } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { resourceSearchBodySchema } from '@/lib/validation/schemas';
import { getResourceBundle } from '@/lib/ai/services/resource-matching.service';

/**
 * 为知识点取「资源包」。
 *
 * 同时开启外部搜索与内部生成，是因为返回结构本身就分了三层可信度
 * （verified / internal / unverified），界面可以按层展示。
 * 外部搜索失败不会让整个请求失败 —— 结果里会带 searchError 与降级提示。
 */
export const POST = withApiHandler(async (request: Request) => {
  const user = await requireUser();
  const body = resourceSearchBodySchema.parse(await readJsonBody(request));

  const bundle = await getResourceBundle({
    userId: user.id,
    knowledgePointId: body.knowledgePointId,
    withExternalSearch: true,
    withInternalMaterials: true,
  });

  return jsonOk(bundle);
});
