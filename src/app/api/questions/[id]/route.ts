import { withApiHandler, jsonOk, readJsonBody } from '@/lib/api/http';
import { AppError } from '@/lib/errors';
import { requireUser } from '@/lib/auth/current-user';
import { questionPatchSchema } from '@/lib/validation/schemas';
import { getQuestionDetail } from '@/lib/questions/service';
import { archiveQuestion, findQuestionForUser, updateQuestion } from '@/lib/repositories/questions.repository';
import {
  findWrongAnswerRecordByQuestion,
  updateWrongAnswerRecord,
} from '@/lib/repositories/mistakes.repository';

/**
 * 单题详情 / 修改 / 归档。
 *
 * 写入路径统一先确认归属：repository 的 updateMany 在「不属于你」时
 * 只会返回 count=0，若直接透传会退化成 500；这里显式转成 404。
 */

export const GET = withApiHandler(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();
    const { id } = await params;
    const detail = await getQuestionDetail(user.id, id);
    return jsonOk({ ...detail });
  },
);

export const PATCH = withApiHandler(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();
    const { id } = await params;
    const body = questionPatchSchema.parse(await readJsonBody(request));

    const existing = await findQuestionForUser(user.id, id);
    if (!existing) {
      throw new AppError('NOT_FOUND', { userMessage: '这道题不存在，或者不属于你。' });
    }

    await updateQuestion(user.id, id, {
      stem: body.stem,
      stemFormat: body.stemFormat,
      choices: body.choices,
      correctAnswer: body.correctAnswer,
      explanation: body.explanation,
      subjectId: body.subjectId,
      grade: body.grade,
      chapter: body.chapter,
      sourceNote: body.sourceNote,
      status: body.status,
    });

    if (body.mistake) {
      const record = await findWrongAnswerRecordByQuestion(user.id, id);
      if (!record) {
        throw new AppError('NOT_FOUND', { userMessage: '这道题还没有错题记录。' });
      }

      // 学生手动改 AI 的分析结果 → 标记 editedByUser，
      // 从此这条记录的结论以学生为准，不再把模型输出当权威
      await updateWrongAnswerRecord(user.id, record.id, {
        errorTypes: body.mistake.errorTypes,
        likelyCauses: body.mistake.likelyCauses,
        explanation: body.mistake.explanation,
        studentAnswer: body.mistake.studentAnswer,
        status: body.mistake.status,
        editedByUser: true,
      });
    }

    const detail = await getQuestionDetail(user.id, id);
    return jsonOk({ ...detail });
  },
);

export const DELETE = withApiHandler(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();
    const { id } = await params;

    const existing = await findQuestionForUser(user.id, id);
    if (!existing) {
      throw new AppError('NOT_FOUND', { userMessage: '这道题不存在，或者不属于你。' });
    }

    // 归档而非物理删除：作答记录与复习计划仍然指向这道题，记录不能被抹掉
    await archiveQuestion(user.id, id);
    return jsonOk({ archived: true });
  },
);
