import { withApiHandler, jsonOk, readQuery } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { masteryQuerySchema } from '@/lib/validation/schemas';
import {
  getMasteryDistribution,
  listMasteryWithKnowledgePoint,
  listStrongMastery,
  listWeakMastery,
} from '@/lib/repositories/mastery.repository';
import { getSubjectNameMap } from '@/lib/repositories/subjects.repository';
import { readNumberRecord } from '@/lib/db/json';
import { masteryLabel } from '@/lib/domain/enums';

/**
 * 掌握度总览。
 *
 * 三种 scope 用的是三套已排序好的 repository 查询：
 *   all    —— 全部已评估记录（按置信度）
 *   weak   —— 薄弱（正在学习 / 初步掌握，按可解释的排序规则）
 *   strong —— 已基本/稳定掌握（按最近评估时间）
 * 排序规则刻意保留在数据层，路由不做二次排序，避免「界面看到的顺序」和
 * 算法给出的优先级不一致。
 */

/** 三种查询的共同形状 —— 让下面的映射逻辑不需要分支 */
type MasteryRowLike = {
  knowledgePointId: string;
  level: string;
  score: number | null;
  confidence: number;
  evidenceCount: number;
  recentAccuracy: number | null;
  recentSampleSize: number;
  repeatedErrorTypes: string;
  needsPrerequisiteReview: boolean;
  nextAction: string | null;
  lastEvaluatedAt: Date | null;
  knowledgePoint: {
    id: string;
    name: string;
    subjectId: string;
    chapterPath: string;
    difficulty?: number | null;
  };
};

export const GET = withApiHandler(async (request: Request) => {
  const user = await requireUser();
  const query = masteryQuerySchema.parse(readQuery(request.url));

  let rows: MasteryRowLike[];
  if (query.scope === 'weak') {
    rows = await listWeakMastery(user.id, query.subjectId ? { subjectId: query.subjectId } : {});
  } else if (query.scope === 'strong') {
    rows = await listStrongMastery(user.id);
  } else {
    rows = await listMasteryWithKnowledgePoint(
      user.id,
      query.subjectId ? { subjectId: query.subjectId } : {},
    );
  }

  // strong 分支的查询不支持按学科过滤，统一在这里收口，保证三个 scope 行为一致
  const filtered = rows
    .filter((row) => !query.subjectId || row.knowledgePoint.subjectId === query.subjectId)
    .filter((row) => !query.level || row.level === query.level);

  const subjectNameMap = await getSubjectNameMap();

  const items = filtered.map((row) => ({
    knowledgePointId: row.knowledgePointId,
    knowledgePointName: row.knowledgePoint.name,
    subjectId: row.knowledgePoint.subjectId,
    subjectName: subjectNameMap.get(row.knowledgePoint.subjectId) ?? '',
    chapterPath: row.knowledgePoint.chapterPath,
    difficulty: row.knowledgePoint.difficulty ?? null,
    level: row.level,
    levelLabel: masteryLabel(row.level),
    score: row.score,
    confidence: row.confidence,
    evidenceCount: row.evidenceCount,
    // 重复错误类型在库里是 JSON TEXT，出库时还原成 {code: count}
    repeatedErrorTypes: readNumberRecord(row.repeatedErrorTypes),
    recentAccuracy: row.recentAccuracy,
    recentSampleSize: row.recentSampleSize,
    needsPrerequisiteReview: row.needsPrerequisiteReview,
    nextAction: row.nextAction,
    lastEvaluatedAt: row.lastEvaluatedAt?.toISOString() ?? null,
  }));

  const distribution = await getMasteryDistribution(user.id);

  return jsonOk({
    items,
    distribution,
    // 「薄弱」= 已进入学习状态但还没稳住的两个等级
    weakCount: (distribution.learning ?? 0) + (distribution.initial ?? 0),
    // 「证据不足」= 未评估 + 证据不足：这两种都不能给出结论，界面要一并提示
    insufficientCount: (distribution.insufficient ?? 0) + (distribution.unevaluated ?? 0),
  });
});
