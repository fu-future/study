import { describe, expect, it } from 'vitest';
import {
  buildTree,
  countTreeNodes,
  findCycles,
  groupByTopChapter,
  orderByPrerequisiteFirst,
  prerequisiteClosure,
  type GraphEdge,
  type GraphNode,
} from '@/lib/knowledge/graph';

/**
 * 前置知识依赖图测试。
 *
 * 业务要点：
 *   - 前置知识闭包用于回答"学生做错这道题，是不是因为基础没打牢"
 *   - 必须能容忍脏数据：父节点缺失、自引用、成环都不能让页面崩掉或陷入死循环
 *   - 返回顺序要"最基础的在最前"，这样复习顺序才是对的
 */

function node(id: string, parentId: string | null = null, chapterPath = id, depth = 0): GraphNode {
  return { id, parentId, chapterPath, depth };
}

function edge(fromId: string, toId: string, strength = 3, relationType = 'prerequisite'): GraphEdge {
  return { fromId, toId, relationType, strength };
}

describe('树结构 buildTree', () => {
  it('正常情况：正确组装多层父子关系', () => {
    const nodes = [
      node('root', null, '章节A', 0),
      node('child1', 'root', '章节A/子1', 1),
      node('child2', 'root', '章节A/子2', 1),
      node('grand', 'child1', '章节A/子1/孙', 2),
    ];

    const tree = buildTree(nodes);

    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe('root');
    expect(tree[0]!.children).toHaveLength(2);
    expect(tree[0]!.children.find((c) => c.id === 'child1')!.children).toHaveLength(1);
    expect(countTreeNodes(tree)).toBe(4);
  });

  it('空数据返回空数组', () => {
    expect(buildTree([])).toEqual([]);
    expect(countTreeNodes([])).toBe(0);
  });

  it('前置知识缺失：parentId 指向不存在的节点 → 当作根节点，不丢数据', () => {
    const tree = buildTree([node('orphan', 'does-not-exist')]);

    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe('orphan');
    expect(countTreeNodes(tree)).toBe(1);
  });

  it('自引用（parentId === 自身）不会被当成父子关系', () => {
    const tree = buildTree([node('self', 'self')]);

    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe('self');
    expect(tree[0]!.children).toHaveLength(0);
  });

  it('循环依赖：a→b→a 不会无限递归，两个节点都被提升为根', () => {
    const nodes = [node('a', 'b'), node('b', 'a')];
    const tree = buildTree(nodes);

    // 不能死循环，也不能丢节点
    expect(countTreeNodes(tree)).toBe(2);
    expect(tree.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('较长的环形链（a→b→c→a）同样被安全处理', () => {
    const nodes = [node('a', 'b'), node('b', 'c'), node('c', 'a')];
    const tree = buildTree(nodes);

    expect(countTreeNodes(tree)).toBe(3);
  });

  it('同级节点按章节路径排序（中文排序不影响稳定性）', () => {
    const nodes = [node('r', null, 'R'), node('c1', 'r', 'A'), node('c2', 'r', 'B'), node('c3', 'r', 'C')];
    const tree = buildTree(nodes);

    expect(tree[0]!.children.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('章节分组 groupByTopChapter', () => {
  it('按章节路径的第一段分组', () => {
    const groups = groupByTopChapter([
      node('a', null, '函数与导数/导数'),
      node('b', null, '函数与导数/单调性'),
      node('c', null, '三角函数/图象'),
    ]);

    expect(groups.get('函数与导数')).toHaveLength(2);
    expect(groups.get('三角函数')).toHaveLength(1);
  });

  it('章节路径为空时归入"未分类"，不抛错', () => {
    const groups = groupByTopChapter([node('x', null, '')]);
    expect(groups.get('未分类')).toHaveLength(1);
  });

  it('空输入返回空 Map', () => {
    expect(groupByTopChapter([]).size).toBe(0);
  });
});

describe('前置知识闭包 prerequisiteClosure', () => {
  // A → B → C （A 是 B 的前置，B 是 C 的前置）
  const chain = [edge('A', 'B', 5), edge('B', 'C', 4)];

  it('正常情况：返回全部前置，最基础的排在最前面', () => {
    const closure = prerequisiteClosure(['C'], chain);

    expect(closure.map((item) => item.id)).toEqual(['A', 'B']);
    expect(closure[0]!.depth).toBe(2);
    expect(closure[1]!.depth).toBe(1);
  });

  it('多起点会合并结果且去重', () => {
    const closure = prerequisiteClosure(['B', 'C'], chain);
    const ids = closure.map((item) => item.id);

    expect(ids).toContain('A');
    expect(ids.filter((id) => id === 'A')).toHaveLength(1);
  });

  it('起点本身不会被当成自己的前置', () => {
    // 加一条成环的边，确认起点不会出现在结果里
    const cyclic = [edge('A', 'B'), edge('B', 'A')];
    const closure = prerequisiteClosure(['A'], cyclic);

    expect(closure.map((item) => item.id)).toEqual(['B']);
  });

  it('前置知识缺失：没有边时返回空数组（不报错）', () => {
    expect(prerequisiteClosure(['Z'], chain)).toEqual([]);
    expect(prerequisiteClosure([], chain)).toEqual([]);
    expect(prerequisiteClosure(['A'], [])).toEqual([]);
  });

  it('边指向不存在的节点时，仍然返回该 id（由调用方决定如何展示）', () => {
    const closure = prerequisiteClosure(['X'], [edge('ghost', 'X', 3)]);

    expect(closure.map((item) => item.id)).toEqual(['ghost']);
  });

  it('非 prerequisite 类型的边被忽略', () => {
    const mixed = [edge('A', 'C', 3, 'related'), edge('B', 'C', 3, 'prerequisite')];
    const closure = prerequisiteClosure(['C'], mixed);

    expect(closure.map((item) => item.id)).toEqual(['B']);
  });

  it('maxDepth 限制回溯层数（过深的前置知识没有提示价值）', () => {
    expect(prerequisiteClosure(['C'], chain, 1).map((item) => item.id)).toEqual(['B']);
    expect(prerequisiteClosure(['C'], chain, 2).map((item) => item.id)).toEqual(['A', 'B']);
    expect(prerequisiteClosure(['C'], chain, 0)).toEqual([]);
  });

  it('循环依赖不会导致死循环，且结果唯一', () => {
    const cyclic = [edge('A', 'B'), edge('B', 'A')];
    const closure = prerequisiteClosure(['A'], cyclic);

    expect(closure).toHaveLength(1);
    expect(new Set(closure.map((item) => item.id)).size).toBe(1);
  });

  it('菱形依赖：取更强的关联、更浅的层级', () => {
    // D 有两条路径：A→D（强度 2）与 B→C→D（强度 5）
    const diamond = [edge('A', 'D', 2), edge('C', 'D', 5), edge('B', 'C', 5)];
    const closure = prerequisiteClosure(['D'], diamond);
    const byId = new Map(closure.map((item) => [item.id, item]));

    expect(byId.get('A')!.depth).toBe(1);
    expect(byId.get('C')!.depth).toBe(1);
    expect(byId.get('B')!.depth).toBe(2);
  });

  it('重复调用结果一致', () => {
    const first = prerequisiteClosure(['C'], chain);
    const second = prerequisiteClosure(['C'], chain);
    expect(second).toEqual(first);
  });
});

describe('复习顺序 orderByPrerequisiteFirst', () => {
  it('前置知识排在目标知识点之前', () => {
    const ordered = orderByPrerequisiteFirst(['C'], [edge('A', 'B'), edge('B', 'C')]);
    expect(ordered).toEqual(['A', 'B', 'C']);
  });

  it('多个知识点：各自的前置先排，且不重复', () => {
    const ordered = orderByPrerequisiteFirst(['C', 'D'], [edge('A', 'C'), edge('A', 'D')]);
    expect(ordered.filter((id) => id === 'A')).toHaveLength(1);
    expect(ordered[ordered.length - 1]).toBe('D');
  });

  it('没有前置关系时只返回原列表', () => {
    expect(orderByPrerequisiteFirst(['X', 'Y'], [])).toEqual(['X', 'Y']);
  });

  it('空输入返回空数组', () => {
    expect(orderByPrerequisiteFirst([], [edge('A', 'B')])).toEqual([]);
  });
});

describe('环检测 findCycles', () => {
  it('有环时能检出，且包含环上所有节点', () => {
    const cycles = findCycles(['a', 'b'], [edge('a', 'b'), edge('b', 'a')]);

    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.slice().sort()).toEqual(['a', 'b']);
  });

  it('无环时返回空数组（链、树、菱形依赖都不算环）', () => {
    expect(findCycles(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c')])).toEqual([]);
    expect(findCycles(['a', 'b', 'c'], [edge('a', 'c'), edge('b', 'c')])).toEqual([]);
    expect(findCycles(['a', 'b'], [])).toEqual([]);
    expect(findCycles([], [])).toEqual([]);
  });

  it('自环也能被检出', () => {
    const cycles = findCycles(['a'], [edge('a', 'a')]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(['a']);
  });

  it('长环 a→b→c→a 检出', () => {
    const cycles = findCycles(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.length).toBeGreaterThanOrEqual(3);
  });

  it('非 prerequisite 边不参与环检测', () => {
    expect(findCycles(['a', 'b'], [edge('a', 'b', 3, 'related'), edge('b', 'a', 3, 'related')])).toEqual([]);
  });

  it('大图不会栈溢出（深链 200 层）', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `n${i}`);
    const edges = ids.slice(0, -1).map((id, index) => edge(id, ids[index + 1]!));

    expect(findCycles(ids, edges)).toEqual([]);
  });
});
