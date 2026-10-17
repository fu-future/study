import { withApiHandler, jsonOk } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { getStudentProfile, toProfileView } from '@/lib/repositories/users.repository';
import { listQuestions, listRecentAttempts } from '@/lib/repositories/questions.repository';
import { listWrongAnswerRecords, toWrongRecordView } from '@/lib/repositories/mistakes.repository';
import { listMasteryWithKnowledgePoint, toMasteryView } from '@/lib/repositories/mastery.repository';
import {
  listStudyPlans,
  listStudyTasks,
  toPlanView,
  toTaskView,
} from '@/lib/repositories/plans.repository';
import {
  getConversationWithMessages,
  listConversations,
} from '@/lib/repositories/conversations.repository';
import { listReviewSchedules, toReviewView } from '@/lib/repositories/review.repository';
import { getSubjectNameMap } from '@/lib/repositories/subjects.repository';
import { toQuestionSummary } from '@/lib/questions/service';

/**
 * 导出本人的全部学习数据（数据可携带权）。
 *
 * 两条硬性约束：
 *   1. **不导出密码哈希** —— 只导出 user 的公开字段；
 *   2. 每一类数据都通过带 userId 的 repository 查询，天然不会越界到别人。
 * 以附件形式下发，方便学生自己存档。
 */
export const GET = withApiHandler(async () => {
  const user = await requireUser();

  const [
    profile,
    subjectNameMap,
    questionRows,
    mistakeRows,
    attemptRows,
    masteryRows,
    planRows,
    taskRows,
    conversationRows,
    reviewRows,
  ] = await Promise.all([
    getStudentProfile(user.id),
    getSubjectNameMap(),
    listQuestions(user.id, { limit: 500 }),
    listWrongAnswerRecords(user.id, { limit: 500 }),
    listRecentAttempts(user.id, { limit: 1000 }),
    listMasteryWithKnowledgePoint(user.id),
    listStudyPlans(user.id, { limit: 200 }),
    listStudyTasks(user.id, { limit: 1000 }),
    listConversations(user.id, { limit: 200 }),
    listReviewSchedules(user.id, { limit: 500 }),
  ]);

  // 题目摘要需要知识点与错题记录，逐条组装（导出接口不在乎这点耗时）
  const questions = await Promise.all(
    questionRows.items.map((item) => toQuestionSummary(item, subjectNameMap.get(item.subjectId))),
  );

  const conversations = [];
  for (const conversation of conversationRows) {
    const detail = await getConversationWithMessages(user.id, conversation.id);
    conversations.push(detail ?? { conversation, messages: [] });
  }

  return jsonOk(
    {
      exportedAt: new Date().toISOString(),
      // 明确只导出可展示字段：passwordHash 绝不出现
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        createdAt: user.createdAt,
      },
      profile: toProfileView(profile),
      questions,
      mistakes: mistakeRows.items.map(toWrongRecordView),
      attempts: attemptRows,
      mastery: masteryRows.map(toMasteryView),
      studyPlans: planRows.map(toPlanView),
      studyTasks: taskRows.map(toTaskView),
      conversations,
      reviewSchedules: reviewRows.map(toReviewView),
    },
    {
      headers: {
        'Content-Disposition': 'attachment; filename="study-data-export.json"',
      },
    },
  );
});
