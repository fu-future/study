import { withApiHandler, jsonOk } from '@/lib/api/http';
import { AppError } from '@/lib/errors';
import { requireUser } from '@/lib/auth/current-user';
import { getConversationWithMessages } from '@/lib/repositories/conversations.repository';

/**
 * 单个会话及其全部消息。
 * 未找到与「属于别人」返回同一个 404 —— 不泄漏某个会话 id 是否存在。
 */
export const GET = withApiHandler(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();
    const { id } = await params;

    const detail = await getConversationWithMessages(user.id, id);
    if (!detail) {
      throw new AppError('NOT_FOUND', { userMessage: '这段对话不存在，或者不属于你。' });
    }

    return jsonOk({ conversation: detail.conversation, messages: detail.messages });
  },
);
