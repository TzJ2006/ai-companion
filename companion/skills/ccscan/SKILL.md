---
name: ccscan
description: 建图入门 —— 把一个项目完整读一遍，读的进度由 hook 记账而不是自报，然后把项目变成一张人可以审的想法图。触发词：ccscan、扫描项目、onboard、建想法图。
---

# ccscan — 读完整个项目，把它变成一张想法图

先读引擎旁边的 FORMAT.md（`node .claude/companion/companion.mjs paths` 会打印所有
规范路径；规范文件就在引擎同目录）。

## 第 0 步 — 先看有没有旧图要迁

```
node .claude/companion/companion.mjs migrate --dry-run
```

发现旧格式的图（带 agent 后缀的 YAML、一节点一文件的 JSON）就先停下：把干跑
报告给人看，让人决定 `migrate` 还是 `--pick` 哪一份。多份旧图并存时命令自己会
停下要求人选择 —— 这不是故障，是规矩：绝不自动挑赢家。迁移完成或确认无旧图，
才开始扫描。

## 第 1 步 — 建扫描清单

```
node .claude/companion/companion.mjs scan
```

清单是程序生成的（git 追踪的加未忽略的新文件，跳过依赖目录和二进制）。
**划掉一行的唯一方式是真的读它** —— 读文件的事件由 hook 记账，你自己说
「读过了」不算数。`scan` 随时重跑可以看剩余。

## 第 2 步 — 读到清单归零

逐个读。读不完就如实报告读了多少、剩多少 —— 剩余数字是程序算的，报告里不许
出现和它对不上的说法。被跳过的文件（vendor、生成物）也要列出来并说明为什么。

## 第 3 步 — 问人：什么叫「这个项目做完了」

用提问工具给人三到五个终点候选，让人选定 endpoints。终点不是你定的。

## 第 4 步 — 提取想法，建图

每个想法回答前三问（是什么 / 为什么 / 预期结果），能答八问的答八问。
新建想法一律用引擎发号：

```
node .claude/companion/companion.mjs new "一句人话的名称" --needs I-001
```

图上每句话都必须让没打开过这个仓库的人看懂 —— 写它做什么，不写它叫什么。

## 第 5 步 — 渲染，停下

```
node .claude/companion/companion.mjs check
node .claude/companion/companion.mjs render
```

把网页路径给人，报告真实的扫描数字（读了几个、跳过几个、剩几个），然后停下
等人审。不要在人看图之前接着做任何事。
