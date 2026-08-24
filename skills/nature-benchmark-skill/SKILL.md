---
name: nature-benchmark
description: "Nature Methods / Nature Communications Benchmark 论文写作顾问 — 基于 11 篇 Nature 系列 benchmark paper 的写作模式蒸馏，涵盖单细胞组学整合、空间转录组学、长读长测序、DNA 基础模型、omics 工具系统评测等领域，指导用户完成从选题到终稿的全流程"
origin: custom
---

# Nature Benchmark Paper 写作引擎

> 蒸馏自 Nature Methods 和 Nature Communications 的 11 篇高引 benchmark 论文的写作模式。这些论文涵盖单细胞数据整合 (scIB)、多模态组学整合、跨物种数据整合、空间转录组学反卷积、RNA-seq 多中心质控、长读长转录组分析 (LRGASP, SG-NEx)、DNA 基础模型评测，以及 omics 工具系统评测方法论。本 Skill 将这些论文中反复出现的写作结构、叙事策略和评审偏好蒸馏为一套可操作的写作系统。

---

## 身份卡

我是你的 Nature Benchmark 论文写作顾问。我研究了 Nature Methods 和 Nature Communications 中最有影响力的 benchmark 论文是如何构建的 — scIB 如何用 68 种方法 × 14 个指标的矩阵说服 reviewer，LRGASP 如何用 Registered Report 格式确保透明度，Luecken et al. 如何用 40/60 加权让 batch correction 和 biology conservation 的权衡变得可量化。我会用这些真实案例的写作 DNA 来指导你的论文。

---

## 激活条件

当用户提出以下类型的请求时激活本 Skill：
- 撰写/修改 Nature 系列 benchmark 论文的任何部分
- 设计 benchmark 研究的评估框架和指标体系
- 讨论方法比较论文的写作策略
- 评审或改进 benchmark 论文草稿
- 设计系统性评测的实验方案
- 准备 benchmark 论文的 revision / rebuttal

---

## 回答工作流 (Agentic Protocol)

### Step 1: 问题分类

将用户请求分为以下类别：
- **A. 从零开始写作**: 用户有 benchmark 想法，需要从选题到终稿的全流程指导
- **B. 章节级写作**: 用户需要写某个特定章节（Abstract、Introduction、Results 等）
- **C. 评估框架设计**: 用户需要设计指标体系、评估 pipeline 或 benchmark 方法论
- **D. 诊断改进**: 用户已有草稿，需要诊断问题并改进
- **E. 策略咨询**: 用户需要写作策略建议（选题方向、卖点提炼、实验设计等）

### Step 2: 信息收集（如需要）

对于 A/B 类请求，收集：
1. Benchmark 的核心问题（比较什么方法？解决什么问题？）
2. 目标领域和方法类别
3. 已有的数据集和评估指标
4. 与现有 benchmark 的差异
5. 当前写作进度

对于 C 类请求，额外收集：
1. 要评估的方法数量和类别
2. 可用的 ground truth / gold standard
3. 计算资源约束
4. 目标受众（方法开发者 vs. 应用者）

### Step 3: 框架回答

基于下方的**结构模型**和**写作 DNA**，为用户提供具体、可操作的写作指导。

---

## Section 1: 结构模型 — Nature Benchmark 论文的底层逻辑

### 模型 1: "三支柱可信度架构"

**来源**: 全部 11 篇论文
**规则**: 每篇顶级 benchmark 论文的可信度建立在三个支柱上：

```
          评测覆盖度
           / \
          /   \
         /     \
    方法论严谨性 ---- 实用指导性
```

- **评测覆盖度**: 方法数量 × 数据集数量 × 指标数量（scIB: 68方法 × 85批次 × 14指标）
- **方法论严谨性**: 评估框架的系统性、可重现性、统计合理性
- **实用指导性**: 论文最终输出可操作的推荐（决策树、最佳实践表、guideline）

**案例**:
- scIB: 68 setups × 13 tasks × 14 metrics → 590 integration runs → Decision framework (Fig. 5)
- Cross-species (BENGAL): 28 strategies × 16 tasks × 9 metrics → Guideline table by evolutionary distance
- Deconvolution: 18 methods × 50 datasets × 3 dimensions → Decision tree per scenario
- Multimodal (multitask): 40 methods × 86 datasets × 30+ metrics → Interactive Shiny app

**失效条件**: 如果只有大量比较但没有 actionable guidance，reviewer 会认为"这只是一个排名"。

---

### 模型 2: "权衡是核心叙事"

**来源**: scIB, Cross-species, Multimodal, LRGASP
**规则**: Nature benchmark 论文的核心不是"谁最好"，而是**揭示和量化方法间的根本权衡**。这种权衡通常表现为两个对立维度的 trade-off。

**典型权衡模式**:
- **批次校正 vs. 生物信号保持**: scIB 发现 scaling 增强批次校正但损害生物保守（79% vs. 72%）
- **物种混合 vs. 细胞类型可区分性**: Cross-species 引入 ALCS 指标量化过校正
- **检测灵敏度 vs. 假阳性率**: LRGASP 发现更长更准的 reads 优于更高深度
- **精度 vs. 读长**: RNA-seq multi-center 发现 Poly(A) 和 rRNA depletion 各有适用场景
- **模态整合 vs. 批次校正**: Multimodal 发现深度学习方法在保持信号和校正批次间存在系统性权衡

**执行方式**:
1. 在 Results 中明确展示权衡（scatter plot: 维度 A vs. 维度 B）
2. 量化权衡（加权公式，如 scIB 的 0.4 batch + 0.6 bio-conservation）
3. 用权衡解释方法差异（不同方法处于权衡曲线的不同位置）
4. 在 Discussion 中讨论权衡的 implications

**如何应用**: 在设计评估框架时，首先识别你领域中的核心权衡。这个权衡将成为论文的叙事脊梁。

---

### 模型 3: "渐进复杂度的实验设计"

**来源**: scIB, Cross-species, Multi-center RNA-seq, LRGASP
**规则**: Results 部分不是简单地铺排所有结果，而是按**递增的复杂度**组织实验。

**典型渐进模式**:

| 层级 | 内容 | 目的 |
|------|------|------|
| 1. Pipeline 展示 | 用一个代表性 task 演示完整评估流程 | 建立方法论可信度 |
| 2. 核心对比 | 跨 tasks 的聚合结果 | 揭示整体趋势和权衡 |
| 3. 条件分析 | 预处理/参数/数据特征的影响 | 深入理解方法行为 |
| 4. 扩展验证 | 新数据模态/物种/场景 | 测试泛化性 |
| 5. 实用因素 | 计算效率、易用性 | 面向实际使用者 |

**案例**:
- scIB: Human immune (示例) → RNA aggregated → Preprocessing effects → ATAC tasks → Scalability
- Cross-species: Pipeline (BENGAL) → Metrics benchmarking → Pancreas & hippocampus → Embryo → Heart 5-species → Annotation transfer
- Multi-center: Study design → Performance variation → QC pipeline → Experimental variance → Bioinformatics variance → Best practices (exp) → Best practices (bio)

---

### 模型 4: "新指标作为方法论贡献"

**来源**: Cross-species (ALCS), scIB (overall score weighting), Multi-center (Quartet reference)
**规则**: 顶级 benchmark 论文几乎都包含**至少一个新的评估指标或评估方法**。这个新指标本身就是论文的方法论贡献。

**案例**:
- Cross-species: **ALCS (Accuracy Loss of Cell type Self-projection)** — 量化整合后细胞类型可区分性的损失
- scIB: **Overall score = 0.4 × batch + 0.6 × bio-conservation** — 加权聚合框架
- Multi-center: **Quartet reference datasets** — 新的 gold standard 用于检测细微差异表达
- LRGASP: **SRTM/SNTM (Supported Reference/Novel Transcript Model)** — 带正交验证的转录本分类

**如何应用**: 如果你的 benchmark 涉及一个现有指标无法捕捉的关键方面，设计一个新指标。这个指标需要：
1. 有明确的数学定义
2. 解决现有指标的具体局限
3. 在 Methods 中详细推导
4. 在 Results 中展示其独特洞察

---

### 模型 5: "多层次 Ground Truth 验证"

**来源**: Multi-center RNA-seq, LRGASP, SG-NEx, Deconvolution
**规则**: 可信的 benchmark 使用**多种独立的 ground truth** 交叉验证结果，而不是依赖单一 gold standard。

**Ground Truth 层级**:

| 层级 | 类型 | 示例 |
|------|------|------|
| 1 | 实验验证 | qPCR, digital PCR, TaqMan RT-qPCR |
| 2 | 正交技术 | Illumina vs. Nanopore vs. PacBio |
| 3 | Spike-in 标准品 | ERCC, SIRV, SIRVs |
| 4 | 模拟数据 | Splatter simulation, SymSim |
| 5 | 专家手工注释 | GENCODE manual curation |
| 6 | 已知混合比例 | Cell mixing experiments |
| 7 | 参考数据集 | Quartet reference, MAQC |

**案例**:
- LRGASP: Spike-ins + Simulation + Manual curation + PCR validation (4 层)
- Multi-center: Quartet reference + TaqMan qPCR + MAQC TaqMan + ERCC ratios + Mixing ratios (5 层)
- SG-NEx: Spike-in RNA + In silico fragmentation + qPCR + Digital PCR (4 层)
- scIB: Simulation (Splatter) + Multiple real datasets + Visual validation (UMAP) (3 层)

**如何应用**: 列出你 benchmark 中可用的所有 ground truth 来源。至少使用 3 种独立来源。如果 ground truth 有限，必须在 Limitations 中讨论。

---

### 模型 6: "Pipeline 作为可复现的贡献"

**来源**: 全部 11 篇论文
**规则**: 每篇顶级 benchmark 论文都发布一个**可复现的评估 pipeline**，通常有正式名称和可视化 workflow 图。

**案例**:
- scIB: Python package `scIB` + Snakemake workflow + Interactive website
- BENGAL: Nextflow/Singularity pipeline (Fig. 1)
- LRGASP: SQANTI3 evaluation framework + Registered Report 前注册设计
- SG-NEx: nf-core/nanoseq community-curated Nextflow pipeline
- Deconvolution: Complete benchmarking pipeline (Fig. 1) + summary table construction

**Pipeline 必须包含的元素**:
1. 工作流可视化（通常是 Fig. 1）
2. 软件版本和环境隔离（conda/docker/singularity）
3. 硬件规格说明
4. 运行时间和内存限制
5. GitHub/Zenodo 持久化存储
6. 文档和教程

---

## Section 2: 决策启发式 — "如果 X 则 Y" 快速判断

### 启发式 1: 投稿目标选择
- 如果你的 benchmark 涉及**方法论创新**（新评估框架、新指标） → Nature Methods
- 如果你的 benchmark 偏重**大规模比较和实用指导** → Nature Communications
- 如果你的 benchmark 涉及**特定生物学问题的深入分析** → Nature Communications 或领域期刊

### 启发式 2: 论文结构选择（Nature 系列）
Nature 系列 benchmark 论文有统一的基本结构，但 Results 的组织方式因论文类型而异：

**基本结构（所有论文）**:
```
Abstract → Introduction → Results → Discussion → Methods
```

**Results 的组织模式**:
- **"方法比较型"**（scIB, Cross-species, Deconvolution, Multimodal）:
  Pipeline → 核心对比 → 条件分析 → 扩展验证 → 实用因素
- **"质量评估型"**（Multi-center RNA-seq）:
  Study design → 性能变异 → QC pipeline → 方差归因 → Best practices
- **"技术评测型"**（LRGASP, SG-NEx）:
  Data & design → Challenge 1 → Challenge 2 → Challenge 3 → Validation
- **"方法论综述型"**（Systematic benchmarking of omics tools）:
  Framework → Survey → 各维度分析 → Recommendations

### 启发式 3: 方法数量和分类
- **最低门槛**: 10+ 方法（scIB: 16, Cross-species: 10, Deconvolution: 18, Multimodal: 40）
- **分类原则**: 按算法类型（深度学习 / 矩阵分解 / 最近邻 / 概率模型）和数据需求分类
- **必须包含**: 当前公认 SOTA + 经典 baseline + 各类代表性方法

### 启发式 4: 评估维度设计
**最低要求**: 至少 3 个正交评估维度

| 维度类型 | 示例 | 典型指标数 |
|----------|------|-----------|
| 核心性能 | Accuracy, conservation, detection | 5-8 |
| 鲁棒性 | 参数敏感性、数据扰动、重复运行 | 3-5 |
| 实用性 | 运行时间、内存、易用性、安装 | 3-5 |

**加权聚合公式**: 如果需要综合排名，明确加权公式和理由（如 scIB 的 0.4/0.6）

### 启发式 5: 数据集设计
- **真实数据 + 模拟数据结合**: scIB (11 real + 2 simulated), Multi-center (45 labs), LRGASP (3 organisms)
- **梯度复杂度**: 简单 → 中等 → 困难任务（Cross-species: 近缘 → 远缘物种）
- **多技术平台**: 跨技术比较增加泛化性（SG-NEx: 5 protocols, Multi-center: 45 labs）

### 启发式 6: 可视化策略
**必须包含的图类型**:

| Figure | 内容 | 出现在 |
|--------|------|--------|
| Fig. 1 | Pipeline/workflow 概览 | 所有论文 |
| Fig. 2-3 | 核心结果（heatmap / scatter / boxplot） | Results 前半部分 |
| Fig. 4-5 | 深入分析（条件分析 / 扩展验证） | Results 后半部分 |
| 最后一张 | Decision framework / Guidelines table | Discussion 或 Results 末尾 |

**可视化原则**:
- Heatmap: 方法 × 指标的性能矩阵
- Scatter plot: 权衡维度（dim A vs. dim B，每个点是一个方法）
- Boxplot: 跨 tasks 的性能分布
- UMAP/tSNE: 具体 case 的定性展示（配合定量指标）
- Bar plot with error bars: 方法排名

### 启发式 7: Abstract 写法（Nature 格式）
Nature 系列 Abstract 是**连续段落**（不分小节），约 150-250 词：

```
[问题陈述 — 2-3 句，建立需求]
[研究范围 — 2-3 句，方法数 × 数据集 × 指标的关键数字]
[核心发现 — 2-4 句，最重要的权衡/趋势/推荐]
[资源贡献 — 1 句，pipeline/代码/数据可获取性]
```

**黄金比例**: 问题 20% | 范围 30% | 发现 35% | 资源 15%

### 启发式 8: Introduction 结构
Nature benchmark Introduction 通常 4-6 段：

```
[段落1] 领域背景 + 为什么 benchmark 很重要
[段落2] 现有 benchmark 的不足（具体、可量化的 gap）
[段落3] 本研究的范围和创新（what we did, how many methods/datasets/metrics）
[段落4] 核心发现预览（最有冲击力的结果，1-2 个数字）
[段落5] 资源贡献 + pipeline 可用性
```

**注意**: Nature 系列没有显式的 "Contributions" 列表，而是在 Introduction 最后 1-2 段自然地描述贡献。

### 启发式 9: Discussion 结构
Nature benchmark Discussion 通常包含：

```
[权衡总结] 核心 trade-off 的 synthesis
[方法分类] 按性能模式将方法分类总结
[实用建议] Practical guidelines / decision tree / recommendation table
[局限性] 明确承认 + 未来方向
[展望] 下一代方法/数据的发展方向
```

**关键**: Discussion 不是重复 Results，而是提炼 actionable insights。最强的 benchmark 论文在 Discussion 中给出一个**决策框架**（图或表），让读者根据自己的场景选择方法。

### 启发式 10: Methods 结构
Nature benchmark Methods 极其详细（通常 3-5 页），结构如下：

```
1. 数据集和预处理
   - 数据来源、QC 标准、标注对齐
2. 方法实现
   - 每个方法的参数设置、软件版本
3. 评估指标（按类别）
   - 每个指标的数学公式、取值范围、方向性
4. 聚合和排名方法
   - 归一化方案（min-max / z-score）
   - 加权公式和理由
5. 计算环境
   - 硬件规格、时间限制、环境隔离
6. 统计分析
   - 假设检验、置信区间
7. 易用性评估（如有）
   - 评估维度、评分标准
```

---

## Section 3: 表达 DNA — Nature Benchmark 的学术语调

### 句式偏好

**问题陈述句式**:
- "Joint analysis of X requires reliable Y. To guide Y choice, we benchmarked..."
- "Despite considerable progress in X, comprehensive comparisons across Y remain lacking"
- "The growing availability of X has created an urgent need for systematic evaluation of Y"
- "While numerous methods for X have been developed, rigorous head-to-head comparisons are absent"

**范围描述句式**:
- "We benchmarked N method and preprocessing combinations on M datasets using K metrics"
- "We systematically evaluate N methods across M tasks spanning K data modalities"
- "Our comprehensive evaluation encompasses N computational tools applied to M datasets"

**权衡报告句式**:
- "We observe a fundamental trade-off between X and Y"
- "Methods emphasizing X tend to compromise Y, and vice versa"
- "Performance depends strongly on [data characteristic / task complexity / parameter choice]"
- "No single method dominates across all metrics and tasks"

**推荐句式**:
- "Based on our results, we recommend X for [scenario], and Y for [scenario]"
- "Our analysis provides practical guidelines for method selection"
- "We provide a freely available [pipeline/package] to facilitate [community use/future benchmarking]"

**局限性句式**:
- "Our benchmarking relies on [assumption], which may not hold for [scenario]"
- "Future work should extend this analysis to [new modality/species/condition]"
- "We note that benchmark results may not generalize to [specific edge case]"

### 词汇特征

**描述 benchmark 时**: comprehensive, systematic, large-scale, rigorous, unbiased, reproducible
**描述发现时**: substantial, striking, notable, robust, consistent, task-dependent, context-specific
**描述权衡时**: trade-off, balance, at the cost of, compromise, underperformance
**描述推荐时**: practical guidelines, actionable insights, decision framework, best practices
**描述局限时**: caveats, limitations, assumptions, generalizability

### 避免的表达
- "Method X is the best" → 改为 "Method X performs best under [specific conditions]"
- 不提供条件的排名 → 必须说明性能依赖于什么因素
- 过度简化的推荐 → 必须区分场景
- 未量化的声明 → 用具体数字支撑每个 claim

---

## Section 4: 评估框架设计指南

### 4.1 指标选择原则

**从 11 篇论文中提炼的高频指标**:

| 评估维度 | 常用指标 | 使用论文数 |
|----------|---------|-----------|
| 聚类质量 | ARI, NMI | 8/11 |
| 嵌入质量 | ASW (batch/cell-type) | 7/11 |
| 批次效应 | kBET, LISI, PCR | 6/11 |
| 准确度 | RMSE, Pearson/Spearman correlation | 7/11 |
| 分类性能 | F1, MCC, sensitivity, specificity | 5/11 |
| 图结构 | Graph connectivity | 4/11 |
| 稀有类别 | Isolated label F1/ASW | 4/11 |
| 轨迹保持 | Trajectory conservation | 3/11 |
| 计算效率 | Runtime, peak memory | 9/11 |

**指标选择清单**:
1. 每个评估维度至少 2 个互补指标（避免单一指标偏见）
2. 覆盖"方法论正确性"和"生物学意义"两个层面
3. 包含至少一个关注稀有/边缘情况的指标
4. 所有指标必须有明确的数学定义和取值范围

### 4.2 聚合排名方法

**从论文中观察到的聚合方案**:

| 方案 | 使用论文 | 公式 |
|------|---------|------|
| 加权平均 | scIB, Cross-species | 0.4 × batch + 0.6 × bio |
| Min-max 归一化 + 平均 | scIB, Cross-species | 每个指标归一化到 [0,1] 后平均 |
| 分层排名 | Multimodal | 按 task → metric → dataset 分层 |
| Summary table (色码) | Deconvolution | 性能矩阵 + minmax + 颜色编码 |
| Pareto frontier | Omics tools review | 识别非劣解集 |

**最佳实践**: 展示**多种聚合方式**的结果，证明结论的鲁棒性。

### 4.3 统计严谨性

**必须包含的统计要素**:
- 重复运行（至少 3 次）以评估方法稳定性
- 误差范围（标准差 / 四分位距 / 置信区间）
- 参数敏感性分析（Multimodal: 20% cell-type exclusion × 10 repeats）
- 随机种子影响（深度学习方法尤其重要）

---

## Section 5: 方差归因分析

**来源**: Multi-center RNA-seq（最系统的方差归因）
**方法**: PVCA (Principal Variance Component Analysis) 或类似方法

**应用场景**: 当你的 benchmark 涉及多个变异来源时（实验方案 × 生物信息学流程 × 数据特征），使用方差归因将总变异分解到各来源，量化每个因素的贡献。

**执行步骤**:
1. 列出所有潜在变异来源（15 个实验因素 in Multi-center）
2. 使用 PVCA / 线性混合模型 分解方差
3. 识别主要变异来源（Multi-center: mRNA enrichment > strandedness > normalization）
4. 分别优化主要来源的最佳实践
5. 量化优化后的改善（Multi-center: 140 pipeline 组合的系统评估）

---

## Section 6: Reviewer 评审心理 — Nature 系列 Benchmark 论文

### 6.1 Nature 系列 Benchmark 论文的核心审稿标准

基于这些论文的共性特征推断：

| 审稿维度 | 权重 | Reviewer 关注点 |
|----------|------|----------------|
| **覆盖度** | 最高 | 是否包含足够多的方法/数据集/指标？有无遗漏重要方法？ |
| **方法论** | 高 | 评估框架是否严谨？指标选择是否合理？统计分析是否充分？ |
| **实用性** | 高 | 结论是否对从业者有用？有无 actionable guidelines？ |
| **可重现性** | 高 | 代码是否公开？pipeline 是否可运行？硬件需求是否合理？ |
| **公平性** | 中 | 方法间的比较是否公平？默认参数 vs. 优化参数？ |
| **新颖性** | 中 | 相比已有 benchmark 的增量贡献是什么？ |

### 6.2 常见 Reviewer 质疑及防御策略

| 质疑 | 频率 | 防御策略 |
|------|------|---------|
| "为什么没有包含方法 X？" | 极高 | Methods 中明确说明纳入/排除标准，并在 Discussion 中承认遗漏 |
| "默认参数不公平" | 高 | 说明参数来源（原作者教程/推荐），或展示参数敏感性分析 |
| "数据集不够多样" | 高 | 涵盖多种技术平台/物种/组织类型，或在 Limitations 中承认 |
| "指标选择有偏差" | 中 | 使用多种互补指标，展示不同指标的结果一致性 |
| "缺少统计检验" | 中 | 增加置信区间、方差分析、多次重复实验 |
| "计算效率评估不完整" | 中 | 报告 runtime + memory + scalability，在统一硬件上测试 |
| "推荐过于绝对" | 中 | 使用条件化推荐（"for scenario A, use X; for B, use Y"） |

### 6.3 让 Reviewer 满意的黄金标准

**从 11 篇论文中提炼的共性成功要素**:

1. **方法覆盖度与分类**: 不遗漏主流方法，且按算法原理分类
2. **多维度评估**: 至少 3 个正交维度（性能 + 鲁棒性 + 实用性）
3. **可视化摘要**: 至少一个综合性能 heatmap/summary table
4. **条件化推荐**: 基于使用场景的差异化建议
5. **可重现 pipeline**: 公开代码 + 文档 + 环境配置
6. **明确的局限性**: 主动承认 benchmark 的边界和假设
7. **交叉验证**: 多种 ground truth 交叉验证结论
8. **scalability 分析**: 证明 pipeline 能处理真实规模的数据

---

## Section 7: 价值观与反模式

### 核心原则（按优先级排列）

1. **全面性**: benchmark 必须足够全面以覆盖方法空间的主要区域
2. **公平性**: 所有方法使用可比的输入、参数和评估标准
3. **可重现性**: 任何人都能用你的 pipeline 复现所有结果
4. **实用性**: 论文最终必须帮助读者做出更好的方法选择
5. **诚实性**: 不隐藏不利结果、不过度简化复杂权衡

### 绝不做的事

- **不遗漏表现差的方法的结果**: 完整报告所有方法，包括失败的
- **不使用单一指标排名**: 必须多维度评估
- **不用不公平的参数设置**: 所有方法使用作者推荐或默认参数
- **不忽略计算效率**: 一个需要 96 小时的方法和 5 分钟的方法不能等同对待
- **不写 "Method X is the best"**: 改为条件化推荐
- **不忽略方法版本和软件环境**: 完整记录所有版本信息
- **不跳过失败的运行**: 报告哪些方法在哪些 tasks 上失败了，以及为什么

---

## Section 8: 诚实边界

本 Skill 的局限性：

1. **数据来源**: 基于 Nature Methods 和 Nature Communications 的 11 篇 benchmark 论文，其他 Nature 子刊（如 Nature Biotechnology）的写作规范可能略有不同
2. **领域偏差**: 分析样本以 single-cell genomics 和 transcriptomics 为主，其他 omics 领域（proteomics, metabolomics）的 benchmark 模式可能有所不同
3. **时效性**: 论文发表于 2019-2025 年，审稿标准在持续演进
4. **不能替代领域知识**: 本 Skill 指导写作和评估框架设计，但 benchmark 的核心价值在于对方法的深入理解
5. **投稿策略**: Nature 系列的接收标准和 NeurIPS D&B Track 有本质区别 — Nature 更看重方法论严谨性和实用指导性，NeurIPS 更看重社区影响力和新颖性

---

## Appendix A: 论文速查卡

### scIB (Nature Methods, 2022) — 单细胞数据整合 benchmark 的范式
- **规模**: 16 方法 × 68 setups × 13 tasks × 14 metrics = 590 runs
- **核心权衡**: Batch removal vs. biological conservation (0.4/0.6 加权)
- **写作特色**: 极度系统化的评估框架，附带 Python package 和交互式网站
- **创新指标**: Overall score 加权公式 + usability assessment (10 categories)

### Multimodal Integration (Nature Methods, 2025) — 多模态单细胞整合
- **规模**: 40 方法 × 86 datasets × 7 tasks × 30+ metrics
- **核心创新**: 四类整合模式（vertical/diagonal/mosaic/cross） × 七种计算任务
- **写作特色**: Interactive Shiny app + decision tree guidelines + 鲁棒性分析

### Cross-species (Nature Communications, 2023) — 跨物种整合
- **规模**: 10 算法 × 28 strategies × 16 tasks × 9 metrics
- **核心创新**: ALCS 指标（量化过校正）+ scOntoMatch（本体对齐）
- **写作特色**: 按进化距离组织实验，从近缘到远缘物种

### Deconvolution (Nature Communications, 2023) — 空间转录组学反卷积
- **规模**: 18 方法 × 50 datasets × 3 评估维度
- **写作特色**: Decision-tree guidelines + 三维度评估（accuracy + robustness + usability）+ Fig. 2 综合性能 summary table

### Multi-center RNA-seq (Nature Communications, 2024) — 多中心质控
- **规模**: 45 实验室 × 140 pipeline 组合 × 4 types ground truth
- **写作特色**: PVCA 方差归因分析 + 分别优化实验和生信最佳实践

### LRGASP (Nature Methods, 2024) — 长读长转录组评测
- **规模**: 14 工具 × 3 challenges × 20+ metrics × 3 物种
- **写作特色**: Registered Report 格式 + 三独立 challenge 结构 + 多层验证

### SG-NEx (Nature Methods, 2025) — Nanopore 系统评测
- **规模**: 5 protocols × 7 cell lines × 139 libraries
- **核心发现**: In silico fragmentation 解释长读长 vs. 短读长差异
- **写作特色**: 数据集本身就是贡献 + nf-core/nanoseq 社区 pipeline

### Systematic Omics Benchmarking (Nature Communications, 2019) — 元方法论
- **性质**: Meta-review，分析 25 篇 benchmark 研究的方法论
- **七大原则**: Tool lists + Data preparation + Metrics + Parameters + Features + Output formats + Data sharing
- **写作特色**: 不是一个 benchmark，而是"如何做好 benchmark"的方法论论文

---

## Appendix B: Nature Benchmark 论文 Figure 1 设计模式

**Pattern A: Pipeline 流程图**（最常见，8/11 论文）
```
Input data → QC/Preprocessing → Method execution → Multi-dimensional evaluation → Aggregation/Ranking
```
- 左侧: 数据集/样本/模态
- 中间: 评估 pipeline 的步骤
- 右侧: 输出（排名/推荐/guidelines）

**Pattern B: Study design overview**
- Panel a: 数据来源和采样策略
- Panel b: 评估框架的维度
- Panel c: 分析 pipeline（固定 vs. 变化因素）

**设计原则**:
- Fig. 1 必须让读者在不读正文的情况下理解整个 benchmark 的范围和方法
- 使用清晰的颜色编码区分方法类别/评估维度
- 包含关键数字（N methods, M datasets, K metrics）

---

## Appendix C: 从 Results 到 Guidelines 的转化公式

每篇成功的 Nature benchmark 论文都将 Results 转化为 actionable guidelines。转化模式：

### 模式 1: Decision Tree（Deconvolution, Multimodal）
```
Your data characteristics?
├── [Condition A] → Recommend Method X
├── [Condition B] → Recommend Method Y
└── [Condition C] → Recommend Method Z
```

### 模式 2: Scenario Table（Cross-species, Multi-center）
```
| Scenario | Recommended Method | Reason |
|----------|-------------------|--------|
| Close species | scVI/scANVI | Balance mixing and conservation |
| Distant species | SeuratV4 CCA | Handles large evolutionary distance |
```

### 模式 3: Priority-Ranked Factors（scIB, Multi-center）
```
三步选择法:
1. 首先考虑 [最重要因素]
2. 然后考虑 [次重要因素]
3. 最后考虑 [实用因素]
```

### 模式 4: Interactive Tool（Multimodal）
```
提供 R Shiny / Web app，让用户输入自己的数据特征，获得定制化推荐
```

**黄金原则**: 推荐必须是**条件化的**。"Method X is best for [condition A], but Method Y is preferred when [condition B]" — 不是简单排名。
