import { withApiHandler, jsonOk, readQuery } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { diagnoseKnowledgePoint } from '@/lib/ai/services/knowledge-diagnosis.service';

/**
 * 单个知识点的完整诊断。
 *
 * narrative 默认关闭：AI 说明会消耗额度与时间，列表页批量诊断时应关掉，
 * 只有用户点开某个知识点时才需要那段「人话总结」。
 * 而且即便 AI 失败，诊断结论（由确定性算法给出）依然完整可用。
 */
export const GET = withApiHandler(
  async (request: Request, { params }: { params: Promise<{ knowledgePointId: string }> }) => {
    const user = await requireUser();
    const { knowledgePointId } = await params;
    const withNarrative = readQuery(request.url).narrative === 'true';

    const diagnosis = await diagnoseKnowledgePoint(user.id, knowledgePointId, { withNarrative });
    return jsonOk({ diagnosis });
  },
);
