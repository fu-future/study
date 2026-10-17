import { withApiHandler, jsonOk, readJsonBody } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { diagnoseBodySchema } from '@/lib/validation/schemas';
import {
  diagnoseKnowledgePoint,
  type DiagnosisView,
} from '@/lib/ai/services/knowledge-diagnosis.service';

/**
 * 批量诊断。
 *
 * 逐个串行执行而不是并发：诊断会 upsert 掌握度记录，
 * 串行能避免同一用户在 SQLite 上的写冲突，也便于逐个失败时给出准确位置。
 */
export const POST = withApiHandler(async (request: Request) => {
  const user = await requireUser();
  const body = diagnoseBodySchema.parse(await readJsonBody(request));

  const items: DiagnosisView[] = [];
  for (const knowledgePointId of body.knowledgePointIds) {
    items.push(
      await diagnoseKnowledgePoint(user.id, knowledgePointId, {
        withNarrative: body.withNarrative,
      }),
    );
  }

  return jsonOk({ items });
});
