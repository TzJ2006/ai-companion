import { describe, it, expect } from "vitest";
import { resolveConfig } from "vitest/node";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// I-145 — 这个仓库的测试套件必须自带一份并发上限和一个抬高过的超时，而且是由
// 仓库根目录的配置文件提供的，不是由谁记得在命令行上多打一个参数提供的。
//
// 为什么断言的是 resolveConfig 的返回值，而不是配置文件的文本：读文本只能证明
// 「文件里写着这个数」，证明不了它被找到、被解析、被用上。resolveConfig 是测试
// 运行器自己导出的入口，走的正是真实那条发现加解析的路，所以这条断言同时守住
// 三种回归 ——
//   1. 有人把上限写进 package.json 的 --maxWorkers 而不是配置文件（那样
//      `npx vitest run` 和图里六十七条 verify.command 一条都管不住）；
//   2. 配置文件放错地方、导出形状不对，静默不生效；
//   3. 升级测试运行器时这个选项被改名或删掉。
// 写下本文件时（未实现前）它返回 maxWorkers=undefined、testTimeout=5000。
const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");

// 人在 I-145 的计划里批准的那条线：上限至多是这台 24 核开发机的一半。写成绝对
// 数而不是「availableParallelism() 的一半」，是因为这条断言要守的是配置里那个
// 数字，不是跑测试的机器 —— 换一台核少的机器时，按机器算会把一个合规的配置判红。
const APPROVED_CEILING = 12;

// 那十六个起真子进程的测试文件在 Windows 上要跑 npx tsx，五秒的默认值撑不住。
const MIN_TIMEOUT_MS = 30_000;

describe("测试套件自带的并发上限与超时（I-145）", () => {
  // 环境变量会覆盖配置文件（coverage.DM_a_rWm.js:380），所以解析前必须把它摘掉：
  // 否则某人 export 了 VITEST_MAX_WORKERS 之后，这条测试会在配置文件根本没起
  // 作用的情况下变绿 —— 那正是它要抓的漏。
  async function resolvedWithoutEnvOverride() {
    const saved = process.env.VITEST_MAX_WORKERS;
    delete process.env.VITEST_MAX_WORKERS;
    try {
      const { vitestConfig } = await resolveConfig({ root: ROOT });
      return vitestConfig;
    } finally {
      if (saved !== undefined) process.env.VITEST_MAX_WORKERS = saved;
    }
  }

  it("仓库根目录的配置文件自己就定住了并发上限", async () => {
    const config = await resolvedWithoutEnvOverride();
    expect(
      typeof config.maxWorkers,
      "没有任何上限在生效 —— 测试运行器会回落到「核数减一」",
    ).toBe("number");
    expect(Number.isInteger(config.maxWorkers)).toBe(true);
    expect(config.maxWorkers).toBeGreaterThanOrEqual(1);
    expect(config.maxWorkers).toBeLessThanOrEqual(APPROVED_CEILING);
  });

  it("单测和钩子的超时都抬到了三十秒以上", async () => {
    const config = await resolvedWithoutEnvOverride();
    expect(config.testTimeout).toBeGreaterThanOrEqual(MIN_TIMEOUT_MS);
    expect(config.hookTimeout).toBeGreaterThanOrEqual(MIN_TIMEOUT_MS);
  });
});
