import { describe, it, expect } from "vitest";
import { topoOrder, type Graph, type Idea } from "../../claude-companion/ideas.js";

// I-060 — 把想法按依赖顺序排列：前置的永远排在前面。
//
// 拓扑序不唯一，所以光测「前置在前」是不够的 —— 三种写法都能通过那条断言，
// 而它们给出三种不同的顺序。这个想法要的是「按层」：先把所有没有前置的输出完
// （层内按 id 排），再输出建立在它们之上的一层。
//
// 三种顺序长得很像，一个三节点直链的夹具分不开它们，所以下面用两个小图各抓一种
// 错实现。两个都要，只有一个就会放过另一种。

const idea = (id: string, needs: string[] = []): Idea =>
  ({ id, name: id, status: "todo", needs });

const graph = (ideas: Idea[]): Graph => ({ version: 1, ideas });

const ids = (list: Idea[]) => list.map((i) => i.id);

describe("I-060 按依赖顺序排列想法", () => {
  // ── expected 的正题 ────────────────────────────────────────────────────
  it("每个想法都排在它全部前置之后，哪怕前置写在文件后面", () => {
    // 书写顺序刻意反着来：前置全在后面。
    const g = graph([
      idea("I-004", ["I-003"]),
      idea("I-003", ["I-002"]),
      idea("I-002", ["I-001"]),
      idea("I-001"),
    ]);
    const out = ids(topoOrder(g));
    expect(out).toEqual(["I-001", "I-002", "I-003", "I-004"]);
    // 一般性检查：任意图上都必须成立，不只是这一条链。
    for (const i of g.ideas) {
      for (const need of i.needs ?? []) {
        expect(out.indexOf(need), `${need} 没排在 ${i.id} 前面`).toBeLessThan(out.indexOf(i.id));
      }
    }
  });

  // ── 夹具一：抓「每步取最小」 ───────────────────────────────────────────
  // I-002 需要 I-001，I-004 需要 I-003。
  // 按层：第一层 {I-001, I-003} → I-001, I-003；第二层 {I-002, I-004}。
  // 每步取最小会先输出 I-002（第二层），把还没输出的第一层 I-003 挤到后面。
  it("同一层内按 id 排 —— 不是每步取全局最小", () => {
    const g = graph([
      idea("I-001"),
      idea("I-002", ["I-001"]),
      idea("I-003"),
      idea("I-004", ["I-003"]),
    ]);
    expect(ids(topoOrder(g))).toEqual(["I-001", "I-003", "I-002", "I-004"]);
  });

  // ── 夹具二：抓「照抄 codex 的先进先出」 ────────────────────────────────
  // I-003 需要 I-002，I-004 需要 I-001。
  // 按层：第一层 {I-001, I-002}；第二层 {I-003, I-004} 按 id 排 → I-003, I-004。
  // 先进先出：弹 I-001 解锁 I-004 入队、弹 I-002 解锁 I-003 入队 → I-004 在 I-003 前面。
  it("层内顺序由 id 决定 —— 不是被解锁的先后（先进先出）", () => {
    const g = graph([
      idea("I-001"),
      idea("I-002"),
      idea("I-003", ["I-002"]),
      idea("I-004", ["I-001"]),
    ]);
    expect(ids(topoOrder(g))).toEqual(["I-001", "I-002", "I-003", "I-004"]);
  });

  // ── 确定性 ─────────────────────────────────────────────────────────────
  it("同样的图，书写顺序打乱之后输出不变", () => {
    const build = (order: number[]) => {
      const all = [idea("I-001"), idea("I-002"), idea("I-003", ["I-002"]), idea("I-004", ["I-001"])];
      return graph(order.map((n) => all[n]));
    };
    const a = ids(topoOrder(build([0, 1, 2, 3])));
    const b = ids(topoOrder(build([3, 2, 1, 0])));
    const c = ids(topoOrder(build([2, 0, 3, 1])));
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  // ── 坏图不能让它卡住或吞节点 ───────────────────────────────────────────
  it("有环也不死循环，环里的节点按 id 排在末尾，一个都不丢", () => {
    const g = graph([
      idea("I-001"),
      idea("I-003", ["I-002"]),   // I-002 ↔ I-003 互为前置
      idea("I-002", ["I-003"]),
    ]);
    const out = ids(topoOrder(g));
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("I-001");                  // 环外的照常先出
    expect(out.slice(1)).toEqual(["I-002", "I-003"]);  // 环里的按 id 排，接在末尾
  });

  it("指向不存在 id 的边直接跳过，不报错也不丢节点", () => {
    // 悬空的边由 check 去报错；排序沿用这个文件里已有的约定：静默忽略。
    const g = graph([idea("I-002", ["I-999"]), idea("I-001")]);
    const out = ids(topoOrder(g));
    expect(out).toHaveLength(2);
    expect(out).toEqual(["I-001", "I-002"]);       // I-002 的入度按 0 算
  });

  it("空图返回空列表", () => {
    expect(topoOrder(graph([]))).toEqual([]);
  });

  // 命令行的 render 从不先跑 check，所以重复 id 会真的走到这里。
  // 用 id 查找表实现的话，重复 id 只会留下最后一个，网页上就凭空少一张卡片。
  it("重复 id 的两个想法都要返回，不能少一个", () => {
    const g = graph([idea("I-001"), idea("I-001"), idea("I-002", ["I-001"])]);
    const out = topoOrder(g);
    expect(out).toHaveLength(3);
    expect(ids(out).filter((i) => i === "I-001")).toHaveLength(2);
  });

  // 返回的是想法对象本身，调用方要能直接拿 name / status 去渲染。
  it("返回的是想法对象本身，不是 id", () => {
    const g = graph([idea("I-002", ["I-001"]), idea("I-001")]);
    const out = topoOrder(g);
    expect(out[0]).toBe(g.ideas[1]);               // 同一个对象引用
    expect(out[0].name).toBe("I-001");
  });
});
