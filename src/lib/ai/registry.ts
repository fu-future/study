import { getEnv } from '@/lib/env';
import type { AiProvider, ProviderCapabilities } from '@/lib/ai/types';
import { MockAiProvider } from '@/lib/ai/providers/mock';
import { OpenAiCompatibleProvider, createDeepSeekProvider } from '@/lib/ai/providers/openai-compatible';
import { AiError } from '@/lib/ai/errors';
import { logger } from '@/lib/logger';

/**
 * Provider 注册表 —— 业务层获取 AI 能力的唯一入口。
 *
 * 为什么需要它：
 *   - 业务模块只写 `getAiProvider().generateText(...)`，永远不 import 某个具体 SDK。
 *   - 换供应商（DeepSeek → 通义 → 自建 vLLM）只需要改 .env，不动业务代码。
 *   - 没有配置 Key 时自动落到 Mock，保证项目「开箱即可运行」。
 *
 * 单例是**进程内**的：构造函数不做网络请求，因此导入本模块不会有副作用。
 */

let cached: AiProvider | null = null;

export function createProviderFromEnv(): AiProvider {
  const env = getEnv();

  switch (env.AI_PROVIDER) {
    case 'mock':
      return new MockAiProvider();

    case 'deepseek':
      return createDeepSeekProvider({
        // env.ts 已交叉校验：非 mock 一定有 apiKey
        apiKey: env.AI_API_KEY ?? '',
        baseUrl: env.AI_BASE_URL || undefined,
        model: env.AI_MODEL || undefined,
        visionModel: env.AI_VISION_MODEL || undefined,
      });

    case 'openai-compatible':
      return new OpenAiCompatibleProvider({
        id: 'openai-compatible',
        label: 'OpenAI 兼容端点',
        baseUrl: env.AI_BASE_URL ?? '',
        apiKey: env.AI_API_KEY ?? '',
        model: env.AI_MODEL || 'gpt-4o-mini',
        visionModel: env.AI_VISION_MODEL || undefined,
      });

    default: {
      // 类型上不可达，但配置出错时给出明确提示而不是静默降级
      throw new AiError('AI_NOT_CONFIGURED', {
        message: `未知的 AI_PROVIDER：${String(env.AI_PROVIDER)}`,
      });
    }
  }
}

export function getAiProvider(): AiProvider {
  if (!cached) {
    cached = createProviderFromEnv();
    logger.info('ai.provider_ready', {
      provider: cached.id,
      model: cached.defaultModel,
      vision: cached.getCapabilities().vision,
    });
  }
  return cached;
}

/** 测试或运行时切换配置后使用。 */
export function resetAiProvider(): void {
  cached = null;
}

/** 对外描述当前 provider 的能力 —— /settings 与 /api/health 使用。 */
export type ProviderStatus = {
  id: string;
  label: string;
  defaultModel: string;
  visionModel?: string;
  capabilities: ProviderCapabilities;
  /** 是否具备真实 AI 能力（mock 视为未配置真实模型） */
  isRealProvider: boolean;
};

export async function describeProviderStatus(): Promise<ProviderStatus> {
  const provider = getAiProvider();
  return {
    id: provider.id,
    label: provider.label,
    defaultModel: provider.defaultModel,
    visionModel: provider.visionModel,
    capabilities: provider.getCapabilities(),
    isRealProvider: provider.id !== 'mock',
  };
}

/**
 * 业务服务调用 AI 前的统一守卫：
 * 需要真实模型能力的场景（如错题图片识别）在 Mock 模式下应给出明确提示，
 * 而不是让用户以为得到了真实结果。
 */
export function assertRealProviderFor(feature: string): void {
  const provider = getAiProvider();
  if (provider.id === 'mock') {
    logger.info('ai.mock_mode_used', { feature });
  }
}
