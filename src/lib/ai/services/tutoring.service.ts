import type { ChatMessage, StreamEvent } from '@/lib/ai/types';
import { getAiProvider } from '@/lib/ai/registry';
import { buildTeachingSystemPrompt, type TeachingContext } from '@/lib/ai/prompts';
import { AiError } from '@/lib/ai/errors';
import { checkRateLimit, logRateLimitDecision } from '@/lib/ai/rate-limit';
import { getStudentProfile, toProfileView } from '@/lib/repositories/users.repository';
import { findSubjectByCode, findSubjectById, resolveSubjectByIdentifier } from '@/lib/repositories/subjects.repository';
import { listWeakMastery } from '@/lib/repositories/mastery.repository';
import { findQuestionForUser } from '@/lib/repositories/questions.repository';
import {
  appendMessage,
  autoTitleConversation,
  createConversation,
  findConversationForUser,
  listRecentMessages,
} from '@/lib/repositories/conversations.repository';
import { getKnowledgePointUsage } from '@/lib/repositories/knowledge.repository';
import type { TeachingMode } from '@/lib/domain/enums';
import { readStringArray } from '@/lib/db/json';
import { AppError } from '@/lib/errors';

/**
 * AI 答疑服务（需求 4.2）。
 *
 * 职责：
 *   1. 组装教学上下文（年级、教材、学科、学生的薄弱知识点、历史对话）
 *   2. 调统一 Provider 接口（不关心背后是 DeepSeek 还是 Mock）
 *   3. 把多轮对话持久化，供「对某一步继续追问」
 *   4. 限流：AI 是花钱的，必须防止连点/脚本
 *
 * 注意：本服务**不做**知识掌握度判断 —— 那些由 diagnosis/engine.ts 的纯算法负责。
 *      答疑内容不会自动写进掌握度，因为"看懂讲解"和"会做"是两件事。
 */

const MAX_CONTEXT_MESSAGES = 10;

export type TutorContext = {
  conversationId?: string;
  mode: TeachingMode;
  grade?: string | null;
  subjectCode?: string | null;
  subjectName?: string | null;
  textbookVersion?: string | null;
  weakKnowledgePoints: string[];
  knowledgePointNames: string[];
  /** 关联错题的题干（从错题本发起追问时） */
  questionStem?: string | null;
  /** 该题已保存的正确答案与解析，帮助 AI 不重复劳动 */
  questionAnswer?: string | null;
  questionExplanation?: string | null;
};

/** 组装上下文。全部来自数据库，未提供的字段就留空 —— 不猜。 */
export async function buildTutorContext(
  userId: string,
  input: {
    mode: TeachingMode;
    conversationId?: string;
    subjectId?: string;
    grade?: string;
    questionId?: string;
  },
): Promise<TutorContext> {
  const profile = toProfileView(await getStudentProfile(userId));

  let subjectCode: string | null = null;
  let subjectName: string | null = null;

  if (input.subjectId) {
    // 归一化：前端可能传 code（math），也可能是 id。外键只认 id。
    const subject = await resolveSubjectByIdentifier(input.subjectId);
    if (subject) {
      subjectCode = subject.code;
      subjectName = subject.name;
    }
  }

  const weak = await listWeakMastery(userId, { limit: 6 });

  let questionStem: string | null = null;
  let questionAnswer: string | null = null;
  let questionExplanation: string | null = null;
  const knowledgePointNames: string[] = [];

  if (input.questionId) {
    const question = await findQuestionForUser(userId, input.questionId);
    if (question) {
      questionStem = question.stem;
      questionAnswer = question.correctAnswer;
      questionExplanation = question.explanation;
      for (const link of question.knowledgePointLinks) {
        knowledgePointNames.push(link.knowledgePoint.name);
        // 若没指定学科，从题目推断
        if (!subjectName) {
          const subject = await findSubjectById(question.subjectId);
          subjectCode = subject?.code ?? null;
          subjectName = subject?.name ?? null;
        }
      }
    }
  }

  return {
    conversationId: input.conversationId,
    mode: input.mode,
    grade: input.grade ?? profile.grade,
    subjectCode,
    subjectName,
    textbookVersion: profile.textbookVersion,
    weakKnowledgePoints: weak.map((row) => row.knowledgePoint.name),
    knowledgePointNames,
    questionStem,
    questionAnswer,
    questionExplanation,
  };
}

/** 把上下文转成系统提示词 + 首轮补充信息。 */
function buildMessages(context: TutorContext, userMessage: string, history: ChatMessage[]): ChatMessage[] {
  const teachingContext: TeachingContext = {
    grade: context.grade,
    subjectCode: context.subjectCode,
    subjectName: context.subjectName,
    textbookVersion: context.textbookVersion,
    mode: context.mode,
    weakKnowledgePoints: context.weakKnowledgePoints,
    knowledgePointNames: context.knowledgePointNames,
  };

  const messages: ChatMessage[] = [
    { role: 'system', content: buildTeachingSystemPrompt(teachingContext) },
  ];

  // 如果是从某道错题发起追问，把题目信息作为背景一次给全，避免多轮重复
  if (context.questionStem) {
    const parts = [`【本次要讨论的题目】\n${context.questionStem}`];
    if (context.questionAnswer) parts.push(`【已记录的正确答案】\n${context.questionAnswer}`);
    if (context.questionExplanation) parts.push(`【已记录的解析】\n${context.questionExplanation}`);
    parts.push('（以上信息由学生自己的错题本提供，可能不完整或有误，如与题干矛盾请指出。）');
    messages.push({ role: 'system', content: parts.join('\n\n') });
  }

  messages.push(...history);
  messages.push({ role: 'user', content: userMessage });

  return messages;
}

/** 保证会话存在且属于当前用户 —— 防止用别人的 conversationId 追加消息。 */
export async function ensureConversation(
  userId: string,
  input: { conversationId?: string; mode: TeachingMode; subjectId?: string; grade?: string; questionId?: string },
): Promise<string> {
  if (input.conversationId) {
    const existing = await findConversationForUser(userId, input.conversationId);
    if (!existing) {
      throw new AppError('NOT_FOUND', { userMessage: '这段对话不存在，或者不属于你。' });
    }
    return existing.id;
  }

  // subjectId 是外键：必须存真实的 Subject.id，而不是 code。
  // 这里再解析一次，避免把 `math` 之类写进外键导致约束失败。
  const subject = input.subjectId ? await resolveSubjectByIdentifier(input.subjectId) : null;

  const created = await createConversation(userId, {
    mode: input.mode,
    subjectId: subject?.id ?? null,
    grade: input.grade ?? null,
    questionId: input.questionId ?? null,
  });
  return created.id;
}

function assertRateLimit(userId: string, scope: string): void {
  const decision = checkRateLimit({ userId, scope });
  if (!decision.allowed) {
    logRateLimitDecision(decision, { userId, scope });
    throw new AiError('AI_RATE_LIMITED', {
      userMessage: `提问有点快啦，等 ${decision.retryAfterSeconds} 秒再继续吧。`,
      details: { retryAfterSeconds: decision.retryAfterSeconds, limit: decision.limit },
    });
  }
}

/**
 * 流式答疑。
 *
 * 返回 AsyncIterable<StreamEvent>，由 Route Handler 转成 SSE。
 * 消息持久化策略：**先存学生提问，再在流结束时存 AI 回复**。
 * 如果中途客户端断开，AI 回复仍会尽力落库（已经生成的部分），
 * 避免出现「学生看到过、记录里没有」的不一致。
 */
export async function* streamTutorReply(params: {
  userId: string;
  conversationId: string;
  context: TutorContext;
  userMessage: string;
  abortSignal?: AbortSignal;
}): AsyncIterable<StreamEvent & { conversationId: string }> {
  const { userId, conversationId, context, userMessage } = params;

  assertRateLimit(userId, 'tutor');

  const history = await listRecentMessages(conversationId, MAX_CONTEXT_MESSAGES);
  const provider = getAiProvider();

  const messages = buildMessages(
    context,
    userMessage,
    history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map<ChatMessage>((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  );

  let fullText = '';
  let model = provider.defaultModel;
  let latencyMs = 0;
  let usage: Record<string, unknown> = {};

  for await (const event of provider.streamText({
    messages,
    service: 'tutoring',
    signal: params.abortSignal,
  })) {
    if (event.type === 'start') {
      model = event.model;
      yield { ...event, conversationId };
      continue;
    }

    if (event.type === 'delta') {
      fullText += event.text;
      yield { ...event, conversationId };
      continue;
    }

    if (event.type === 'usage') {
      usage = { ...event.usage };
      yield { ...event, conversationId };
      continue;
    }

    if (event.type === 'done') {
      latencyMs = event.latencyMs;
      // 落库：AI 回复 + 元数据（不含提示词正文）
      if (fullText.trim()) {
        await appendMessage(conversationId, {
          role: 'assistant',
          content: fullText,
          contentType: 'markdown',
          metadata: { model, latencyMs, retryCount: event.retryCount, usage },
        });
      }
      yield { ...event, conversationId };
      continue;
    }

    // 错误事件：把已生成的部分也存下来，方便学生回看
    if (event.type === 'error') {
      if (fullText.trim()) {
        await appendMessage(conversationId, {
          role: 'assistant',
          content: `${fullText}\n\n> ⚠️ 回复中断：${event.message}`,
          contentType: 'markdown',
          metadata: { model, partial: true, errorCode: event.code },
        });
      }
      yield { ...event, conversationId };
    }
  }
}

/** 非流式答疑（供测试与不支持的客户端使用）。 */
export async function answerOnce(params: {
  userId: string;
  conversationId: string;
  context: TutorContext;
  userMessage: string;
}): Promise<{ text: string; model: string; latencyMs: number }> {
  assertRateLimit(params.userId, 'tutor');

  const history = await listRecentMessages(params.conversationId, MAX_CONTEXT_MESSAGES);
  const provider = getAiProvider();

  const messages = buildMessages(
    params.context,
    params.userMessage,
    history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map<ChatMessage>((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  );

  const result = await provider.generateText({ messages, service: 'tutoring' });

  await appendMessage(params.conversationId, {
    role: 'assistant',
    content: result.text,
    metadata: { model: result.model, latencyMs: result.latencyMs },
  });

  return { text: result.text, model: result.model, latencyMs: result.latencyMs };
}

/** 保存学生提问（在开始生成之前调用，保证"问过什么"一定有记录）。 */
export async function saveUserMessage(
  conversationId: string,
  userMessage: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await appendMessage(conversationId, {
    role: 'user',
    content: userMessage,
    contentType: 'text',
    metadata,
  });
  await autoTitleConversation(conversationId, userMessage);
}

/**
 * 「要求用更简单的语言重新讲解」等快捷指令的措辞。
 * 保持在这里集中管理，避免前端硬编码中文提示词。
 */
export const QUICK_INSTRUCTIONS = {
  simpler: '上面的解释我还是不太懂。请用更简单的方式重新讲一遍，多用生活里的类比，少用术语。',
  stepBack: '请只讲这一步：为什么可以这样做？其他部分先不用管。',
  similarExample: '请再给我出一道类似的例题（不要给答案），我想自己试试。',
  practice: '请给我 2 道巩固练习题（先不要给答案），我做完再来对。',
  examReview: '我刚做错了这道题。请帮我复盘：错误发生在哪一步，以及下次怎么避免。',
} as const;

export type QuickInstructionKey = keyof typeof QUICK_INSTRUCTIONS;

/** 从错题本一键发起「考试复盘」对话。 */
export async function startExamReviewConversation(userId: string, questionId: string): Promise<string> {
  const question = await findQuestionForUser(userId, questionId);
  if (!question) {
    throw new AppError('NOT_FOUND', { userMessage: '这道题不存在，或者不属于你。' });
  }

  const subject = await findSubjectById(question.subjectId);

  const conversation = await createConversation(userId, {
    title: `复盘：${question.stem.slice(0, 20) || '错题'}`,
    mode: 'exam-review',
    subjectId: question.subjectId,
    questionId,
  });
  const knowledgePointNames = question.knowledgePointLinks.map((l) => l.knowledgePoint.name);
  const choices = readStringArray(question.choices);

  const prompt = [
    '请帮我复盘这道错题。',
    '',
    `题干：${question.stem || '（题干未录入）'}`,
    choices.length ? `选项：\n${choices.join('\n')}` : '',
    question.correctAnswer ? `正确答案：${question.correctAnswer}` : '',
    knowledgePointNames.length ? `关联知识点：${knowledgePointNames.join('、')}` : '',
    subject ? `学科：${subject.name}` : '',
    '',
    '请指出我可能在哪一步出了问题，并总结一个下次可以复用的方法。',
  ]
    .filter(Boolean)
    .join('\n');

  await saveUserMessage(conversation.id, prompt, { source: 'mistake-book', questionId });

  return conversation.id;
}

/** 供 /settings 展示：某知识点的证据使用情况（用于说明"为什么没有结论"）。 */
export async function describeKnowledgePointEvidence(
  knowledgePointId: string,
): Promise<{ referencingQuestions: number }> {
  const usage = await getKnowledgePointUsage(knowledgePointId);
  return { referencingQuestions: usage.questions };
}

export { findSubjectByCode };
