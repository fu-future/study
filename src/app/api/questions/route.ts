import { withApiHandler, jsonOk, readJsonBody, readQuery } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { questionCreateSchema, questionListQuerySchema } from '@/lib/validation/schemas';
import {
  createQuestionWithOptionalMistake,
  listMistakeSummaries,
  toQuestionSummary,
  type QuestionSummary,
} from '@/lib/questions/service';
import { listQuestions } from '@/lib/repositories/questions.repository';
import { getSubjectNameMap } from '@/lib/repositories/subjects.repository';

/**
 * 题目列表 / 新建题目。
 *
 * 列表有两条路径：
 *   - onlyMistakes=true → 走错题本（带错题记录与复习状态）
 *   - 否则 → 走全部题目（含没有错题记录的练习题）
 * 两者的过滤条件与返回结构保持一致，前端可以用同一个组件渲染。
 */

export const GET = withApiHandler(async (request: Request) => {
  const user = await requireUser();
  const query = questionListQuerySchema.parse(readQuery(request.url));

  if (query.onlyMistakes) {
    const { items, total } = await listMistakeSummaries(user.id, {
      subjectId: query.subjectId,
      knowledgePointId: query.knowledgePointId,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
    return jsonOk({ items, total });
  }

  const { items, total } = await listQuestions(user.id, {
    subjectId: query.subjectId,
    knowledgePointId: query.knowledgePointId,
    search: query.search,
    source: query.source,
    status: query.status,
    limit: query.limit,
    offset: query.offset,
  });

  const subjectNameMap = await getSubjectNameMap();
  const summaries: QuestionSummary[] = await Promise.all(
    items.map((item) => toQuestionSummary(item, subjectNameMap.get(item.subjectId))),
  );

  return jsonOk({ items: summaries, total });
});

export const POST = withApiHandler(async (request: Request) => {
  const user = await requireUser();
  const body = questionCreateSchema.parse(await readJsonBody(request));

  const result = await createQuestionWithOptionalMistake({
    userId: user.id,
    input: {
      subjectId: body.subjectId,
      grade: body.grade ?? null,
      chapter: body.chapter ?? null,
      stem: body.stem,
      stemFormat: body.stemFormat,
      choices: body.choices,
      correctAnswer: body.correctAnswer ?? null,
      explanation: body.explanation ?? null,
      sourceNote: body.sourceNote ?? null,
      source: 'manual',
    },
    // 手动指定的知识点：第一个作为主知识点，避免「谁主谁次」不确定
    knowledgePoints: body.knowledgePointIds?.map((knowledgePointId, index) => ({
      knowledgePointId,
      isPrimary: index === 0,
      source: 'manual',
      confidence: 1,
    })),
    mistake: {
      create: body.createMistake,
      studentAnswer: body.studentAnswer ?? null,
      errorTypes: body.errorTypes,
      source: 'manual',
    },
  });

  return jsonOk(result);
});
