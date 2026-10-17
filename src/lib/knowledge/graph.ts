/**
 * 知识点图谱运算（纯函数，可测试）。
 *
 * 知识点体系有两个维度：
 *   1. **树**：章节层级（parentId / chapterPath），用于「知识点地图」
 *   2. **有向图**：前置 / 后续关联（KnowledgePointRelation），用于
 *      「这道题做错，是不是因为前置知识没打牢」的判断
 *
 * 这里只做图运算，不碰数据库 —— 数据由 repository 取好传进来。
 */

export type GraphNode = {
  id: string;
  parentId?: string | null;
  chapterPath: string;
  depth: number;
};

export type GraphEdge = {
  fromId: string;
  toId: string;
  relationType: string;
  strength: number;
};

// -----------------------------------------------------------------------------
// 树
// -----------------------------------------------------------------------------

export type TreeNode<T extends GraphNode> = T & { children: TreeNode<T>[] };

/**
 * 把扁平列表组装成树。
 * 容错策略：
 *   - parentId 指向不存在的节点 → 视为根节点（脏数据不能让整个地图崩掉）
 *   - 存在环 → 把环上节点提升为根，避免无限递归
 */
export function buildTree<T extends GraphNode>(nodes: readonly T[]): TreeNode<T>[] {
  const byId = new Map<string, TreeNode<T>>();
  for (const node of nodes) {
    byId.set(node.id, { ...node, children: [] });
  }

  const roots: TreeNode<T>[] = [];

  for (const node of nodes) {
    const self = byId.get(node.id)!;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;

    if (parent && parent.id !== self.id && !wouldCreateCycle(byId, self.id, parent.id)) {
      parent.children.push(self);
    } else {
      roots.push(self);
    }
  }

  sortTree(roots);
  return roots;
}

function wouldCreateCycle<T extends GraphNode>(
  byId: Map<string, TreeNode<T>>,
  childId: string,
  parentId: string,
): boolean {
  // 从 parent 往上走，若遇到 child 则说明成环
  let cursor: string | undefined = parentId;
  const visited = new Set<string>();

  while (cursor) {
    if (cursor === childId) return true;
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? undefined;
  }

  return false;
}

function sortTree<T extends GraphNode>(nodes: TreeNode<T>[]): void {
  nodes.sort((a, b) => a.chapterPath.localeCompare(b.chapterPath, 'zh-Hans-CN'));
  for (const node of nodes) sortTree(node.children);
}

export function countTreeNodes<T extends GraphNode>(nodes: readonly TreeNode<T>[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countTreeNodes(node.children), 0);
}

/** 按章节路径前缀分组（用于地图的"章节"层） */
export function groupByTopChapter<T extends GraphNode>(nodes: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const node of nodes) {
    const top = node.chapterPath.split('/').filter(Boolean)[0] ?? '未分类';
    const list = groups.get(top) ?? [];
    list.push(node);
    groups.set(top, list);
  }
  return groups;
}

// -----------------------------------------------------------------------------
// 前置知识图
// -----------------------------------------------------------------------------

/**
 * 计算若干知识点的**全部前置知识**（传递闭包），按"先学哪个"的顺序返回。
 *
 * 用途：学生在「导数的几何意义」上反复出错时，系统要能说
 *      「建议先补『函数的极限』和『平均变化率』」，而不是笼统地说"基础不牢"。
 *
 * 返回顺序：拓扑序（最基础的在最前）。同一层内按关联强度降序。
 *
 * @param seedIds  起点知识点（通常是做错的那道题关联的知识点）
 * @param edges    全部 prerequisite 边（from = 前置，to = 后继）
 * @param maxDepth 最大回溯层数，默认 3 —— 太深的前置知识离当前问题太远，
 *                 提示出来反而无意义（例如"建议重学小学数学"）
 */
export function prerequisiteClosure(
  seedIds: readonly string[],
  edges: readonly GraphEdge[],
  maxDepth = 3,
): { id: string; depth: number; strength: number }[] {
  // 构建反向索引：to ← from（即"谁是我的前置"）
  const prereqOf = new Map<string, { id: string; strength: number }[]>();
  for (const edge of edges) {
    if (edge.relationType !== 'prerequisite') continue;
    const list = prereqOf.get(edge.toId) ?? [];
    list.push({ id: edge.fromId, strength: edge.strength });
    prereqOf.set(edge.toId, list);
  }

  const found = new Map<string, { depth: number; strength: number }>();
  const queue: { id: string; depth: number; strength: number }[] = [];
  const seeds = new Set(seedIds);

  for (const seed of seedIds) {
    for (const prereq of prereqOf.get(seed) ?? []) {
      queue.push({ id: prereq.id, depth: 1, strength: prereq.strength });
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;

    // 起点本身不应当被当成自己的前置
    if (seeds.has(current.id)) continue;
    if (current.depth > maxDepth) continue;

    const existing = found.get(current.id);
    // 保留更强的关联、更浅的层级
    if (!existing || existing.depth > current.depth || existing.strength < current.strength) {
      found.set(current.id, { depth: current.depth, strength: current.strength });
    } else {
      // 已经以更优的路径访问过，不再展开
      continue;
    }

    for (const prereq of prereqOf.get(current.id) ?? []) {
      queue.push({ id: prereq.id, depth: current.depth + 1, strength: prereq.strength });
    }
  }

  // 越基础（depth 相同则强度越高）越靠前
  return [...found.entries()]
    .map(([id, meta]) => ({ id, depth: meta.depth, strength: meta.strength }))
    .sort((a, b) => b.depth - a.depth || b.strength - a.strength);
}

/**
 * 按「前置链」排序复习顺序：前置知识先复习，再进行当前知识点。
 * 返回的 id 列表中，越靠前表示越应该先处理。
 */
export function orderByPrerequisiteFirst(
  ids: readonly string[],
  edges: readonly GraphEdge[],
  maxDepth = 3,
): string[] {
  const closure = prerequisiteClosure(ids, edges, maxDepth);
  const prereqIds = closure.map((item) => item.id);

  // 先放更基础的（closure 已按"从深到浅"排序，即最基础在前）
  const ordered = [...prereqIds];
  for (const id of ids) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

/** 找出图中的环 —— 数据导入后的完整性检查用（有环会破坏前置推断）。 */
export function findCycles(nodeIds: readonly string[], edges: readonly GraphEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of edges) {
    if (edge.relationType !== 'prerequisite') continue;
    adjacency.get(edge.fromId)?.push(edge.toId);
  }

  const cycles: string[][] = [];
  const state = new Map<string, 0 | 1 | 2>(); // 0=未访问 1=访问中 2=完成
  const stack: string[] = [];

  const dfs = (node: string): void => {
    state.set(node, 1);
    stack.push(node);

    for (const next of adjacency.get(node) ?? []) {
      const nextState = state.get(next) ?? 0;
      if (nextState === 1) {
        // 找到环：截取栈中从 next 到当前节点的部分
        const startIndex = stack.indexOf(next);
        if (startIndex !== -1) cycles.push(stack.slice(startIndex));
      } else if (nextState === 0) {
        dfs(next);
      }
    }

    stack.pop();
    state.set(node, 2);
  };

  for (const id of nodeIds) {
    if ((state.get(id) ?? 0) === 0) dfs(id);
  }

  return cycles;
}
