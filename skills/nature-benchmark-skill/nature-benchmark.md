---
name: nature-benchmark
description: Nature Benchmark 论文写作顾问 — 基于 11 篇 Nature 系列 benchmark paper 的写作模式蒸馏
user_invocable: true
---

# /nature-benchmark

Nature Methods / Nature Communications benchmark 论文写作指导。

## 用法

```
/nature-benchmark                              # 交互式写作指导（从头开始）
/nature-benchmark abstract                     # 写 Abstract
/nature-benchmark intro                        # 写 Introduction
/nature-benchmark results                      # 设计 Results 结构
/nature-benchmark discussion                   # 写 Discussion
/nature-benchmark methods                      # 写 Methods
/nature-benchmark metrics                      # 设计评估指标体系
/nature-benchmark guidelines                   # 设计实用推荐/决策树
/nature-benchmark review "<draft text>"        # 诊断并改进草稿
/nature-benchmark fig1                         # 设计 Figure 1
/nature-benchmark checklist                    # 投稿前检查清单
```

## 指导流程

1. 加载 `SKILL.md` 中的写作模型和模式
2. 根据用户请求分类（从零写作 / 章节写作 / 框架设计 / 诊断 / 咨询）
3. 收集必要信息（benchmark 内容、方法数量、数据集、指标）
4. 基于 11 篇论文的模式提供具体、可操作的写作建议
5. 使用案例支撑每个建议（"scIB 这样做了..."、"LRGASP 的做法是..."）

## 检查清单模式

当用户使用 `/nature-benchmark checklist` 时，逐项检查：

### 结构完整性
- [ ] Abstract: 问题 → 范围(数字) → 发现 → 资源
- [ ] Introduction: 背景 → 现有不足 → 本研究 → 关键发现 → 贡献
- [ ] Results: Pipeline → 核心对比 → 条件分析 → 扩展验证 → 实用因素
- [ ] Discussion: 权衡总结 → 推荐 → 局限性 → 展望
- [ ] Methods: 数据集 → 方法实现 → 指标定义 → 聚合排名 → 计算环境

### 评估框架
- [ ] ≥10 方法被比较
- [ ] ≥3 正交评估维度
- [ ] 每个维度 ≥2 互补指标
- [ ] 多种 ground truth 交叉验证
- [ ] 鲁棒性分析（参数敏感性/随机种子/数据扰动）
- [ ] 计算效率评估（runtime + memory）
- [ ] 聚合排名方法明确且合理

### 可视化
- [ ] Fig. 1: Pipeline/workflow 概览图
- [ ] 综合性能 heatmap / summary table
- [ ] 权衡 scatter plot（dim A vs. dim B）
- [ ] 条件分析图（预处理/参数影响）
- [ ] Decision framework / guidelines 图

### 可重现性
- [ ] 代码公开（GitHub + 永久存储如 Zenodo）
- [ ] 软件版本和环境配置完整
- [ ] 硬件规格和运行时间报告
- [ ] 数据可获取性声明

### 公平性和诚实性
- [ ] 方法纳入/排除标准明确
- [ ] 参数设置来源说明（默认 / 作者推荐 / 优化）
- [ ] 失败的方法/运行已报告
- [ ] 推荐是条件化的（非绝对排名）
- [ ] 局限性明确承认
