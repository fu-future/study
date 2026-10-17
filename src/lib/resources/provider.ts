import { z } from 'zod';
import type { ResourceVerification } from '@/lib/domain/enums';

/**
 * 资源检索 Provider 接口（需求 4.6）。
 *
 * 核心约束（需求反复强调的「不要编造」）：
 *   - Provider **只能返回真实存在的资源**，不能生成标题、链接、时长。
 *   - 外部搜索得到的结果一律标记为 `unverified`，界面上必须与 `verified` 明确区分。
 *   - 拿不到资源时返回空数组 + 说明，由上层降级到「系统内部讲解 + 练习」。
 *
 * 允许接入的类型（对应需求列举的四类 + 管理员维护）：
 *   1. 内部资源库（管理员维护 / 系统讲解）  → internal
 *   2. 官方教育资源目录                     → official-catalog（预留，需要真实 API）
 *   3. 经授权的教育资源 API                 → custom-json
 *   4. 可配置的搜索 API                     → tavily
 */

export type ResourceCandidate = {
  title: string;
  resourceType: 'explanation' | 'example' | 'practice' | 'video' | 'textbook' | 'article';
  provider: string;
  platform: string | null;
  url: string;
  verificationStatus: ResourceVerification;
  /** 视频时长（秒）。**拿不到就留空**，不要估算。 */
  durationSeconds: number | null;
  description: string | null;
  /** 内部生成的正文（external 资源为空） */
  content?: string | null;
  /** 与知识点的相关度 0..1 */
  relevance?: number;
  lastVerifiedAt?: Date | null;
};

export type SearchContext = {
  knowledgePointId: string;
  knowledgePointName: string;
  chapterPath: string;
  subjectName: string;
  grade: string;
};

export interface ResourceProvider {
  readonly id: string;
  readonly label: string;
  /** 该 provider 返回的资源是否可被信任为「已验证」 */
  readonly trustLevel: 'verified' | 'unverified';
  search(context: SearchContext, signal?: AbortSignal): Promise<ResourceCandidate[]>;
}

// -----------------------------------------------------------------------------
// 外部搜索响应校验：不信任第三方返回的结构
// -----------------------------------------------------------------------------

const tavilyResultSchema = z.object({
  title: z.string().optional(),
  url: z.string(),
  content: z.string().optional(),
  score: z.number().optional(),
});

const tavilyResponseSchema = z.object({
  results: z.array(tavilyResultSchema).default([]),
});

/** 只接受 http/https 链接 —— 防止把危险协议写进资源库/渲染成可点击链接 */
export function isSafeResourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Tavily 风格的搜索 API 适配器（可配置的搜索 API，对应需求里的第 4 类）。
 *
 * ⚠️ 返回结果一律 `unverified`：我们没有能力也没有义务去核验第三方搜索结果的内容。
 *    界面上会明确写「以下来自搜索结果，未经核验」。
 *    API Key 只在服务端读取，绝不下发。
 */
export class TavilySearchProvider implements ResourceProvider {
  readonly id = 'tavily';
  readonly label = '外部搜索（结果未核验）';
  readonly trustLevel = 'unverified' as const;

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl?: string;
      timeoutMs: number;
    },
  ) {}

  async search(context: SearchContext, signal?: AbortSignal): Promise<ResourceCandidate[]> {
    const baseUrl = (this.options.baseUrl || 'https://api.tavily.com').replace(/\/+$/, '');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetch(`${baseUrl}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          query: buildSearchQuery(context),
          // 只搜教学类资源，减少娱乐内容干扰
          search_depth: 'basic',
          max_results: 8,
          include_domains: [],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // 失败就是失败 → 上层降级，不要用假数据兜底
        throw new Error(`搜索接口返回 ${response.status}`);
      }

      const parsed = tavilyResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error('搜索接口返回的结构不符合预期');
      }

      return parsed.data.results
        .filter((item) => isSafeResourceUrl(item.url))
        .map<ResourceCandidate>((item) => ({
          title: item.title?.trim() || new URL(item.url).hostname,
          resourceType: guessResourceType(item.url, item.title ?? ''),
          provider: this.id,
          platform: safeHostname(item.url),
          url: item.url,
          // 关键：外部搜索结果永远标记为未核验
          verificationStatus: 'unverified',
          // 从不猜测时长
          durationSeconds: null,
          description: item.content?.slice(0, 300) ?? null,
          relevance: typeof item.score === 'number' ? Math.max(0, Math.min(1, item.score)) : 0.5,
        }));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** 通用「自定义 JSON 搜索接口」适配器：字段映射可配置。 */
export class CustomJsonSearchProvider implements ResourceProvider {
  readonly id = 'custom-json';
  readonly label = '自定义资源接口（结果未核验）';
  readonly trustLevel = 'unverified' as const;

  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey?: string;
      timeoutMs: number;
      /** 字段映射：默认按 { items: [{title,url,description,duration}] } 解析 */
      mapping?: {
        itemsPath?: string;
        titleKey?: string;
        urlKey?: string;
        descriptionKey?: string;
        durationKey?: string;
      };
    },
  ) {}

  async search(context: SearchContext, _signal?: AbortSignal): Promise<ResourceCandidate[]> {
    const mapping = {
      titleKey: 'title',
      urlKey: 'url',
      descriptionKey: 'description',
      durationKey: 'durationSeconds',
      ...this.options.mapping,
    };

    const url = new URL(this.options.baseUrl);
    url.searchParams.set('q', buildSearchQuery(context));
    url.searchParams.set('subject', context.subjectName);

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    if (!response.ok) throw new Error(`资源接口返回 ${response.status}`);

    const body = (await response.json()) as Record<string, unknown>;
    const itemsPath = this.options.mapping?.itemsPath;
    const rawItems = itemsPath
      ? itemsPath.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], body)
      : (body.items ?? body.results ?? []);

    if (!Array.isArray(rawItems)) return [];

    const candidates: ResourceCandidate[] = [];
    for (const item of rawItems) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const rawUrl = record[mapping.urlKey];
      if (typeof rawUrl !== 'string' || !isSafeResourceUrl(rawUrl)) continue;

      const duration = record[mapping.durationKey];

      candidates.push({
        title: typeof record[mapping.titleKey] === 'string' ? (record[mapping.titleKey] as string) : rawUrl,
        resourceType: guessResourceType(rawUrl, String(record[mapping.titleKey] ?? '')),
        provider: this.id,
        platform: safeHostname(rawUrl),
        url: rawUrl,
        verificationStatus: 'unverified',
        // 只有当接口真的给了数字才记录时长；字符串/缺失一律为 null
        durationSeconds: typeof duration === 'number' && duration > 0 ? Math.round(duration) : null,
        description:
          typeof record[mapping.descriptionKey] === 'string'
            ? (record[mapping.descriptionKey] as string).slice(0, 300)
            : null,
      });
    }

    return candidates;
  }
}

/**
 * 构建检索词。
 * 刻意加入「高中」与「讲解」，因为面向的是高中生，
 * 不加限定词容易被大学课件与考研资料淹没。
 */
export function buildSearchQuery(context: SearchContext): string {
  return [context.grade, context.subjectName, context.knowledgePointName, '讲解'].filter(Boolean).join(' ');
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * 根据 URL 与标题**推测**资源类型。
 * 这只是分类便利，不影响可信度标记 —— 推测错了也只是归类不准，不会变成"已验证"。
 */
function guessResourceType(url: string, title: string): ResourceCandidate['resourceType'] {
  const haystack = `${url} ${title}`.toLowerCase();
  if (/(bilibili|youtube|video|v\.qq|iqiyi|youku|\.mp4)/.test(haystack)) return 'video';
  if (/(pdf|教材|课本|textbook|book)/.test(haystack)) return 'textbook';
  if (/(题|练习|exercise|practice|试卷)/.test(haystack)) return 'practice';
  if (/(例题|example)/.test(haystack)) return 'example';
  return 'article';
}
