import { withApiHandler, jsonOk, readJsonBody } from '@/lib/api/http';
import { AppError } from '@/lib/errors';
import { requireUser } from '@/lib/auth/current-user';
import { analyzeBodySchema } from '@/lib/validation/schemas';
import {
  analyzeQuestionImage,
  analyzeQuestionText,
  type AnalysisResult,
} from '@/lib/ai/services/question-analysis.service';
import {
  createQuestionWithOptionalMistake,
  type CreateQuestionResult,
} from '@/lib/questions/service';
import { findKnowledgePointByCode } from '@/lib/repositories/knowledge.repository';
import { findSubjectByCode, findSubjectById } from '@/lib/repositories/subjects.repository';
import { readUploadAsBase64 } from '@/lib/storage/uploads';

/**
 * 错题识别与分析。
 *
 * 两种入口：上传图片（先识别再分析）/ 手动录入题干（直接分析）。
 * 无论哪条路，**都不能假装成功**：
 *   - 识别不清 → needsUserConfirmation=true，由学生核对
 *   - Mock 模式 → confidence 已被服务层置 0，界面必须显示「示例数据」
 * 因此这里的职责只是把服务层结论如实转述，不额外"美化"。
 */
export const POST = withApiHandler(async (request: Request) => {
  const user = await requireUser();
  const body = analyzeBodySchema.parse(await readJsonBody(request));

  let result: AnalysisResult;
  let uploadedImageMime: string | null = null;

  if (body.uploadId) {
    const image = await readUploadAsBase64(body.uploadId);
    uploadedImageMime = image.mimeType;
    result = await analyzeQuestionImage({
      userId: user.id,
      imageBase64: image.base64,
      mimeType: image.mimeType,
      hint: body.hint,
      subjectId: body.subjectId ?? null,
      grade: body.grade ?? null,
    });
  } else {
    if (!body.stem) {
      throw new AppError('VALIDATION_ERROR', {
        userMessage: '请填写题干，或先上传题目图片。',
      });
    }
    result = await analyzeQuestionText({
      userId: user.id,
      stem: body.stem,
      choices: body.choices,
      studentAnswer: body.studentAnswer ?? null,
      correctAnswer: body.correctAnswer ?? null,
      subjectId: body.subjectId ?? null,
      grade: body.grade ?? null,
    });
  }

  const { analysis } = result;

  // 模型只可能返回 code，且已被服务层白名单过滤；这里把 code 换成完整信息供界面展示
  const matchedKnowledgePoints: {
    id: string;
    code: string;
    name: string;
    chapterPath: string;
  }[] = [];
  for (const code of result.matchedKnowledgePointCodes) {
    const point = await findKnowledgePointByCode(code);
    if (point) {
      matchedKnowledgePoints.push({
        id: point.id,
        code: point.code,
        name: point.name,
        chapterPath: point.chapterPath,
      });
    }
  }

  let created: CreateQuestionResult | null = null;

  if (body.createMistake) {
    // 学科优先用学生显式选择；否则回落到模型识别出的学科 code
    const subject = body.subjectId
      ? await findSubjectById(body.subjectId)
      : analysis.subject
        ? await findSubjectByCode(analysis.subject)
        : null;

    if (!subject) {
      throw new AppError('VALIDATION_ERROR', {
        userMessage: '请先选择学科，再保存为错题。',
      });
    }

    created = await createQuestionWithOptionalMistake({
      userId: user.id,
      input: {
        subjectId: subject.id,
        grade: body.grade ?? null,
        // 识别不出题干时保存空串，由界面要求人工补全 —— 绝不编造题目内容
        stem: analysis.stem,
        choices: analysis.choices,
        correctAnswer: analysis.correctAnswer || null,
        explanation: analysis.explanation || null,
        imagePath: body.uploadId ?? null,
        imageMimeType: uploadedImageMime,
        source: body.uploadId ? 'image-upload' : 'manual',
        sourceNote: body.hint ?? null,
        // Mock / 识别不清时服务层已把 confidence 置 0，这里不再改动
        ocrConfidence: analysis.confidence,
      },
      knowledgePoints: matchedKnowledgePoints.map((point, index) => ({
        knowledgePointId: point.id,
        isPrimary: index === 0,
        source: 'ai',
        confidence: analysis.confidence,
      })),
      mistake: {
        create: true,
        studentAnswer: body.studentAnswer ?? null,
        errorTypes: analysis.errorTypes,
        likelyCauses: analysis.likelyCauses,
        explanation: analysis.explanation || null,
        errorConfidence: analysis.confidence,
        source: body.uploadId ? 'image-upload' : 'manual',
      },
    });
  }

  return jsonOk({
    analysis,
    matchedKnowledgePoints,
    rejectedKnowledgePointCodes: result.rejectedKnowledgePointCodes,
    model: result.model,
    providerId: result.providerId,
    latencyMs: result.latencyMs,
    isMock: result.isMock,
    // 学生必须看到这个标记，才会去核对题干，而不是直接当作"识别成功"
    needsUserConfirmation: analysis.needsUserConfirmation,
    question: created?.question ?? null,
    mistakeCreated: created?.mistakeCreated ?? false,
    firstReview: created?.firstReview ?? null,
  });
});
