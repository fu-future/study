import { withApiHandler, jsonOk, readQuery } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { knowledgePointQuerySchema } from '@/lib/validation/schemas';
import { findMastery, toMasteryView } from '@/lib/repositories/mastery.repository';
import { listKnowledgePoints } from '@/lib/repositories/knowledge.repository';
import { getSubjectNameMap } from '@/lib/repositories/subjects.repository';
import { readStringArray } from '@/lib/db/json';

/**
 * 知识点列表。
 *
 * 掌握度信息默认不返回：它是「用户 × 知识点」的逐条查询，
 * 列表页用不上，只在 `?withMastery=true` 时才付出这部分成本。
 */
export const GET = withApiHandler(async (request: Request) => {
  const user = await requireUser();

  // 查询参数全是字符串，交给 schema 统一做类型收窄与默认值
  const raw = readQuery(request.url);
  const query = knowledgePointQuerySchema.parse(raw);
  const withMastery = raw.withMastery === 'true';

  const { items, total } = await listKnowledgePoints(query);
  const subjectNameMap = await getSubjectNameMap();

  const enriched = [];
  for (const point of items) {
    const mastery = withMastery ? await findMastery(user.id, point.id) : null;
    enriched.push({
      ...point,
      // 这两个字段在库里是 JSON TEXT，出库时必须还原成数组
      commonMistakes: readStringArray(point.commonMistakes),
      typicalQuestionTypes: readStringArray(point.typicalQuestionTypes),
      subjectName: subjectNameMap.get(point.subjectId) ?? '',
      mastery: mastery ? toMasteryView(mastery) : null,
    });
  }

  return jsonOk({ items: enriched, total });
});
