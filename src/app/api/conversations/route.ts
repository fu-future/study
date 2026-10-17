import { withApiHandler, jsonOk } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { listConversations } from '@/lib/repositories/conversations.repository';

/** 会话列表。repository 已带 userId 条件，不会串到别人的对话。 */
export const GET = withApiHandler(async () => {
  const user = await requireUser();
  const rows = await listConversations(user.id);

  return jsonOk({
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      mode: row.mode,
      subjectId: row.subjectId,
      subjectName: row.subject?.name ?? null,
      messageCount: row._count.messages,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
});
