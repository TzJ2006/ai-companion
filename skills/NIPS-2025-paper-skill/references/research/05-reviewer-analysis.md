# NeurIPS 2025 D&B Track - Reviewer 评审模式分析

> 基于 7 篇 Oral + 8 篇 Spotlight 论文的 61 条 official reviews 分析

## 一、评分分布

### Oral Papers (avg rating)
| 论文 | R1 | R2 | R3 | R4 | R5 | AVG |
|------|----|----|----|----|-----|-----|
| Artificial Hivemind **(Best Paper)** | 6 | 4 | 4 | 5 | - | **4.75** |
| WebGen-Bench | 5 | 4 | 5 | 6 | - | 5.00 |
| BEDLAM2.0 | 5 | 5 | 5 | 6 | - | 5.25 |
| CoralVQA | 5 | 6 | 4 | 5 | 5 | 5.00 |
| OrthoLoC | 5 | 5 | 5 | 5 | - | 5.00 |
| RISEBench | 5 | 5 | 5 | 5 | - | 5.00 |
| NOVA | 5 | 5 | 5 | 5 | - | 5.00 |

### Spotlight Papers
| 论文 | R1 | R2 | R3 | R4 | AVG |
|------|----|----|----|----|-----|
| Gymnasium | 6 | 6 | 4 | 6 | 5.50 |
| Why Multi-Agent Fail | 6 | 5 | 5 | 5 | 5.25 |
| MME | 5 | 5 | 6 | 6 | 5.50 |
| Data-Juicer 2.0 | 4 | 5 | 6 | 6 | 5.25 |
| SWE-smith | 6 | 4 | 5 | 5 | 5.00 |
| TabArena | 4 | 6 | 5 | 5 | 5.00 |
| Reasoning Gym | 4 | 5 | 6 | 5 | 5.00 |
| ResearchCodeBench | 5 | 5 | 5 | 5 | 5.00 |

### 关键发现
1. **Best Paper 平均分最低 (4.75)** — AC 判断比 reviewer 分数更重要
2. **Oral 平均分 ~5.0，Spotlight 平均分 ~5.16** — 分数差异极小，AC 决策是关键
3. **5 分是基准线** — 大多数 top paper 的分数集中在 5（Accept），有分歧的论文靠 AC 拍板
4. **Oral 分数不一定比 Spotlight 高** — Gymnasium (5.50) > 所有 Oral papers

## 二、Reviewer 最赞赏的品质（按频率排序）

| 排名 | 品质 | 频率 | 含义 |
|------|------|------|------|
| 1 | comprehensive | 17 | 评测/数据集覆盖面广 |
| 2 | community | 17 | 对社区有价值 |
| 3 | novel | 15 | 新颖性 |
| 4 | important | 13 | 问题/贡献的重要性 |
| 5 | valuable | 13 | 有使用价值 |
| 6 | significant | 13 | 贡献显著 |
| 7 | practical | 12 | 实用性强 |
| 8 | real-world | 12 | 真实世界应用 |
| 9 | systematic | 10 | 方法论系统化 |
| 10 | timely | 9 | 时机好、紧跟热点 |

### Reviewer 赞美的典型句式
- "The benchmark has been **meticulously constructed**"
- "This is a **well-qualified work** and would **interest the community**"
- "The **comprehensive evaluation** and analysis highlighted **interesting dimensions**"
- "This benchmark **solves an impactful real-world problem**"
- "The study introduces X, **the first** benchmark for..."

## 三、Reviewer 最常批评的问题（按频率排序）

| 排名 | 批评点 | 频率 | 如何预防 |
|------|--------|------|---------|
| 1 | "lack" | 30 | 缺少某些分析/比较/细节 → 写论文时覆盖面要广 |
| 2 | "evaluation/metric" | 28/20 | 评估不够充分或指标选择有问题 → 多维度评估 |
| 3 | "could/should" | 27/21 | 建议做更多 → 在附录中提前覆盖潜在问题 |
| 4 | "detail" | 18 | 细节不足 → 标注流程、实验设置要详细 |
| 5 | "comparison" | 16 | 缺少与现有工作的对比 → 必须有对比表格 |
| 6 | "small/scale" | 15/12 | 规模不够大 → 用数字说话，展示规模优势 |
| 7 | "analysis" | 15 | 分析不够深入 → 包含影响因素/失败模式分析 |
| 8 | "bias/diversity" | 10/10 | 数据偏差或多样性不足 → 主动讨论局限性 |
| 9 | "generalization" | 8 | 泛化性存疑 → 跨域/跨场景测试 |
| 10 | "baseline" | 8 | 基线不够或选择不当 → 包含最新 SOTA |

### Reviewer 批评的典型句式
- "The paper **lacks** a systematic analysis of..."
- "It would be **more** convincing if the authors **could**..."
- "The **comparison** with existing works is **limited**"
- "The **scale** of the dataset is relatively **small** compared to..."
- "It is **unclear** **how** the proposed method generalizes to..."

## 四、AC (Area Chair) 决策模式

### AC Comment 的典型结构
1. 论文摘要（1-2 句）
2. 评审一致性描述（"all reviewers recommend..."）
3. Rebuttal 效果（"authors addressed concerns..."）
4. AC 自己的判断
5. 推荐决策

### AC 决策的关键因素
从 7 篇 Oral 的 AC Comments 中提炼：

1. **社区影响力** — "impact to the community is for sure" (BEDLAM2.0)
2. **问题的重要性** — "solves an impactful real-world problem" (CoralVQA)
3. **评测的全面性** — "comprehensive evaluation and analysis" (CoralVQA)
4. **Rebuttal 质量** — "authors addressed in the rebuttal, leaving reviewers convinced" (WebGen-Bench)
5. **一致性** — "uniformly positive evaluations from four reviewers" (OrthoLoC)

### Best Paper 选择逻辑 (Artificial Hivemind)
尽管平均分最低 (4.75)，仍获 Best Paper，因为：
- **揭示了一个重要现象** (Artificial Hivemind / LM 同质性)
- **概念的影响力超越了技术贡献** — "call on the community to think deeper"
- **数据集的独特设计** — 开放式查询 + 高密度人工标注

**启示**: Best Paper 不是分数最高的论文，而是**对领域认知产生最大冲击的论文**。

## 五、Oral vs Spotlight 的评审差异

| 维度 | Oral | Spotlight |
|------|------|-----------|
| 平均分 | 5.00 | 5.16 |
| 分数方差 | 低 (多为全5) | 高 (常有4和6) |
| AC 介入度 | 高 (详细 comment) | 中 |
| 决定因素 | AC 判断 + 论文影响力 | 分数 + reviewer 一致性 |
| 典型特征 | 首创性 or 重大发现 | 实用性 or 全面性 |

## 六、给论文写作的 Actionable 建议

### 防御性写作清单（基于最高频批评点）

1. **对比表格必须有** (comparison, 16次提及)
   - Table 1 必须与现有数据集/benchmark 逐维度对比

2. **评估要多维度** (evaluation/metric, 28/20次)
   - 至少 3 个评估维度，不只一个指标

3. **细节要充分** (detail, 18次)
   - 标注指南、数据采集流程、模型超参数都要详细描述
   - 放不下正文就放附录

4. **规模要有说服力** (small/scale, 15/12次)
   - 在摘要中直接报告关键数字
   - 如果规模确实不大，用质量/多样性来弥补

5. **分析要深入** (analysis, 15次)
   - 不只比较分数，要分析 why — 影响因素、错误案例

6. **主动讨论局限** (bias/diversity, 10/10次)
   - Limitations section 不是形式，是建立信任的工具

7. **最新 baseline** (baseline, 8次)
   - 必须包含最新的闭源模型（GPT-4o, Claude, Gemini）
