import { getEnv } from '@/lib/env';
import { getAiProvider } from '@/lib/ai/registry';
import { checkRateLimit } from '@/lib/ai/rate-limit';
import { buildTeachingSystemPrompt } from '@/lib/ai/prompts';
import {
  TavilySearchProvider,
  CustomJsonSearchProvider,
  buildSearchQuery,
  type ResourceCandidate,
  type ResourceProvider,
  type SearchContext,
} from '@/lib/resources/provider';
import { listResourcesForKnowledgePoint, createResource, linkResourceToKnowledgePoint } from '@/lib/repositories/resources.repository';
import { findKnowledgePointById } from '@/lib/repositories/knowledge.repository';
import { findSubjectById } from '@/lib/repositories/subjects.repository';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { readStringArray } from '@/lib/db/json';
import { AiError } from '@/lib/ai/errors';
import type { ResourceVerification } from '@/lib/domain/enums';

/**
 * 资源匹配服务（需求 4.6）。
 *
 * 返回结构刻意分三层，让界面可以明确区分可信度：
 *   1. verified    —— 库内已核验的资源（管理员维护 / 系统生成且已审核）
 *   2. internal    —— 系统即时生成的知识点讲解与练习（不依赖外部链接，永远可用）
 *   3. unverified  —— 外部搜索结果，**明确标注未核验**
 *
 * 当 1 和 3 都为空时，`degraded = true`，界面显示
 * 「暂无已验证的匹配资源」，并重点呈现第 2 层 —— 这是需求明确要求的降级方案。
 */

export type ResourceView = {
  id: string;
  title: string;
  resourceType: string;
  provider: string;
  platform: string | null;
  url: string;
  verificationStatus: ResourceVerification;
  lastVerifiedAt: string | null;
  durationSeconds: number | null;
  description: string | null;
  subjectId: string | null;
  grade: string | null;
  difficulty: number | null;
};

export type InternalMaterial = {
  kind: 'explanation' | 'practice';
  title: string;
  /** Markdown 正文 */
  content: string;
  /** 是否为 Mock 占位内容（界面必须显示提示） */
  isMock: boolean;
  model: string | null;
};

export type ResourceBundle = {
  knowledgePoint: {
    id: string;
    name: string;
    chapterPath: string;
    subjectId: string;
    subjectName: string;
    grade: string;
    difficulty: number;
    commonMistakes: string[];
    typicalQuestionTypes: string[];
  };
  verified: ResourceView[];
  unverified: ResourceView[];
  internal: InternalMaterial[];
  /** 是否需要显示「暂无已验证资源」的降级提示 */
  degraded: boolean;
  message: string | null;
  /** 建议的检索关键词（供学生自己去可信平台搜索，不伪造链接） */
  searchKeywords: string[];
  /** 外部搜索失败的原因（如果有） */
  searchError: string | null;
};

function toView(row: Awaited<ReturnType<typeof listResourcesForKnowledgePoint>>[number]): ResourceView {
  return {
    id: row.id,
    title: row.title,
    resourceType: row.resourceType,
    provider: row.provider,
    platform: row.platform,
    url: row.url,
    verificationStatus: row.verificationStatus as ResourceVerification,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    durationSeconds: row.durationSeconds,
    description: row.description,
    subjectId: row.subjectId,
    grade: row.grade,
    difficulty: row.difficulty,
  };
}

function candidatesToViews(candidates: ResourceCandidate[]): ResourceView[] {
  return candidates.map((candidate, index) => ({
    // 外部结果没有数据库 id，用稳定的合成 id（不写库，避免污染资源库）
    id: `external:${index}:${candidate.url.slice(0, 64)}`,
    title: candidate.title,
    resourceType: candidate.resourceType,
    provider: candidate.provider,
    platform: candidate.platform,
    url: candidate.url,
    verificationStatus: candidate.verificationStatus,
    lastVerifiedAt: candidate.lastVerifiedAt?.toISOString() ?? null,
    durationSeconds: candidate.durationSeconds,
    description: candidate.description,
    subjectId: null,
    grade: null,
    difficulty: null,
  }));
}

/** 按配置构建外部搜索 Provider 列表。默认不启用任何外部搜索（最安全）。 */
export function buildSearchProviders(): { providers: ResourceProvider[]; error: string | null } {
  const env = getEnv();

  switch (env.RESOURCE_SEARCH_PROVIDER) {
    case 'tavily': {
      if (!env.RESOURCE_SEARCH_API_KEY) {
        return { providers: [], error: '未配置 RESOURCE_SEARCH_API_KEY，外部搜索已跳过。' };
      }
      return {
        providers: [
          new TavilySearchProvider({
            apiKey: env.RESOURCE_SEARCH_API_KEY,
            baseUrl: env.RESOURCE_SEARCH_BASE_URL || undefined,
            timeoutMs: env.RESOURCE_SEARCH_TIMEOUT_MS,
          }),
        ],
        error: null,
      };
    }

    case 'custom-json': {
      if (!env.RESOURCE_SEARCH_BASE_URL) {
        return { providers: [], error: '未配置 RESOURCE_SEARCH_BASE_URL，外部搜索已跳过。' };
      }
      return {
        providers: [
          new CustomJsonSearchProvider({
            baseUrl: env.RESOURCE_SEARCH_BASE_URL,
            apiKey: env.RESOURCE_SEARCH_API_KEY || undefined,
            timeoutMs: env.RESOURCE_SEARCH_TIMEOUT_MS,
          }),
        ],
        error: null,
      };
    }

    case 'internal-only':
    default:
      return { providers: [], error: null };
  }
}

/**
 * 为知识点取资源包。
 *
 * @param withExternalSearch 是否执行外部搜索（会消耗配额，列表页应传 false）
 * @param withInternalMaterials 是否即时生成系统讲解与练习（需要 AI，可按需关闭）
 */
export async function getResourceBundle(params: {
  userId: string;
  knowledgePointId: string;
  withExternalSearch?: boolean;
  withInternalMaterials?: boolean;
}): Promise<ResourceBundle> {
  const knowledgePoint = await findKnowledgePointById(params.knowledgePointId);
  if (!knowledgePoint) {
    throw new AppError('NOT_FOUND', { userMessage: '没有找到这个知识点。' });
  }

  const subject = await findSubjectById(knowledgePoint.subjectId);
  const subjectName = subject?.name ?? '';

  const stored = await listResourcesForKnowledgePoint(params.knowledgePointId);
  const verified = stored.filter((r) => r.verificationStatus === 'verified').map(toView);
  const storedUnverified = stored.filter((r) => r.verificationStatus !== 'verified').map(toView);

  const searchContext: SearchContext = {
    knowledgePointId: knowledgePoint.id,
    knowledgePointName: knowledgePoint.name,
    chapterPath: knowledgePoint.chapterPath,
    subjectName,
    grade: knowledgePoint.grade,
  };

  // ---- 外部搜索（可选，失败不影响主体功能）----
  let external: ResourceView[] = [];
  let searchError: string | null = null;

  if (params.withExternalSearch) {
    const { providers, error } = buildSearchProviders();
    searchError = error;

    for (const provider of providers) {
      try {
        const candidates = await provider.search(searchContext);
        external = [...external, ...candidatesToViews(candidates)];
      } catch (error) {
        // 搜索失败不是致命错误 —— 记录原因，继续用内部资源兜底
        searchError = error instanceof Error ? error.message : String(error);
        logger.warn('resources.search_failed', { provider: provider.id, reason: searchError });
      }
    }
  }

  // ---- 系统内部讲解与练习 ----
  let internal: InternalMaterial[] = [];
  if (params.withInternalMaterials) {
    internal = await generateInternalMaterials(params.userId, {
      name: knowledgePoint.name,
      chapterPath: knowledgePoint.chapterPath,
      subjectName,
      grade: knowledgePoint.grade,
      difficulty: knowledgePoint.difficulty,
      commonMistakes: readStringArray(knowledgePoint.commonMistakes),
    });
  }

  const unverified = [...storedUnverified, ...external];
  const degraded = verified.length === 0;

  const message = degraded
    ? unverified.length > 0
      ? '暂时没有已验证的匹配资源。下面是系统为你生成的讲解和练习，可以先用它们；标为「未核验」的是搜索结果，内容需要你自己判断。'
      : '暂时没有已验证的匹配资源。下面是系统为你生成的讲解和练习（不依赖外部链接，随时可用）。'
    : null;

  return {
    knowledgePoint: {
      id: knowledgePoint.id,
      name: knowledgePoint.name,
      chapterPath: knowledgePoint.chapterPath,
      subjectId: knowledgePoint.subjectId,
      subjectName,
      grade: knowledgePoint.grade,
      difficulty: knowledgePoint.difficulty,
      commonMistakes: readStringArray(knowledgePoint.commonMistakes),
      typicalQuestionTypes: readStringArray(knowledgePoint.typicalQuestionTypes),
    },
    verified,
    unverified,
    internal,
    degraded,
    message,
    searchKeywords: [buildSearchQuery(searchContext), `${subjectName} ${knowledgePoint.name} 例题`].filter(
      Boolean,
    ),
    searchError,
  };
}

/**
 * 生成系统内部的「知识点讲解 + 针对性练习」。
 *
 * 这是资源缺失时的降级方案（需求：如果无法获取真实资源，明确提示暂无已验证的匹配资源，
 * 同时提供系统生成的知识点讲解和练习）。
 * Mock 模式下返回**明确的占位内容**，而不是看起来像真答案的东西。
 */
async function generateInternalMaterials(
  userId: string,
  context: {
    name: string;
    chapterPath: string;
    subjectName: string;
    grade: string;
    difficulty: number;
    commonMistakes: string[];
  },
): Promise<InternalMaterial[]> {
  const decision = checkRateLimit({ userId, scope: 'resource-matching', cost: 2 });
  if (!decision.allowed) {
    return [];
  }

  const provider = getAiProvider();
  const isMock = provider.id === 'mock';

  const systemPrompt = buildTeachingSystemPrompt({
    grade: context.grade,
    subjectName: context.subjectName,
    mode: 'detailed',
  });

  const materials: InternalMaterial[] = [];

  try {
    const explanation = await provider.generateText({
      service: 'resource-matching',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            `请为高中生写一份「${context.name}」的知识点讲解。`,
            `章节：${context.chapterPath}　学科：${context.subjectName}　年级：${context.grade}　难度参考：${context.difficulty}/5`,
            context.commonMistakes.length
              ? `学生常见错误：${context.commonMistakes.join('；')}。请在讲解中针对这些错误给出提醒。`
              : '',
            '',
            '要求：',
            '1. 结构：一句话概括 → 定义与公式 → 适用条件 → 一个最小例子 → 常见坑。',
            '2. 不要编造教材页码、视频链接或知识点编号。',
            '3. 数学公式用 LaTeX（$...$ / $$...$$）。',
            '4. 篇幅控制在 500 字以内。',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    });

    materials.push({
      kind: 'explanation',
      title: `${context.name} · 知识讲解（系统生成）`,
      content: explanation.text,
      isMock,
      model: explanation.model,
    });
  } catch (error) {
    logger.warn('resources.explanation_failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const practice = await provider.generateText({
      service: 'resource-matching',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            `请针对「${context.name}」（${context.subjectName} · ${context.grade}）出 2 道练习题。`,
            '要求：',
            '1. 先只给题目，**不要在题目前给出答案或解析**。',
            '2. 题目难度：一道基础、一道中等偏上。',
            '3. 在最后用「参考答案」小节给出简要答案与关键步骤。',
            '4. 数学公式用 LaTeX。',
          ].join('\n'),
        },
      ],
    });

    materials.push({
      kind: 'practice',
      title: `${context.name} · 针对性练习（系统生成）`,
      content: practice.text,
      isMock,
      model: practice.model,
    });
  } catch (error) {
    logger.warn('resources.practice_failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  if (materials.length === 0) {
    // 两个都失败：给出一条可解释的提示，而不是空白
    materials.push({
      kind: 'explanation',
      title: '暂时无法生成讲解',
      content:
        'AI 暂时不可用，所以没能生成讲解内容。你可以稍后重试，或先到知识点地图查看该知识点的常见错误与典型题型。',
      isMock: true,
      model: null,
    });
  }

  return materials;
}

/**
 * 管理员把外部搜索结果「收编」进资源库时使用。
 * 只有显式标记 verified=true 才会写入核验时间 —— 不自动核验任何东西。
 */
export async function importResourceFromSearch(params: {
  knowledgePointId: string;
  candidate: ResourceCandidate;
  verified: boolean;
  createdBy: string;
  subjectId?: string | null;
  grade?: string | null;
}): Promise<{ id: string }> {
  const resource = await createResource({
    title: params.candidate.title,
    resourceType: params.candidate.resourceType,
    provider: params.candidate.provider,
    platform: params.candidate.platform,
    url: params.candidate.url,
    verificationStatus: params.verified ? 'verified' : 'unverified',
    verifiedBy: params.verified ? params.createdBy : null,
    subjectId: params.subjectId ?? null,
    grade: params.grade ?? null,
    durationSeconds: params.candidate.durationSeconds,
    description: params.candidate.description,
    createdBy: params.createdBy,
  });

  await linkResourceToKnowledgePoint({
    resourceId: resource.id,
    knowledgePointId: params.knowledgePointId,
    matchSource: 'manual',
  });

  return { id: resource.id };
}

export { AiError };
