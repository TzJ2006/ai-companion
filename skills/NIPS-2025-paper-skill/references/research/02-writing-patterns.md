# NeurIPS 2025 DB Track Top Papers - 写作模式分析

## 一、论文结构模式

### 精简模式 (RISEBench 型，4 章)
1. Introduction
2. [Benchmark Name] (含构建 + 评估)
3. Experiments
4. Conclusion
- **特点**: Related Work 放入附录，正文极度聚焦，附录丰富（可达 8 个）

### 标准模式 (OrthoLoC 型，6 章)
1. Introduction
2. Related Work
3. The Dataset
4. Method/Localization Framework
5. Experiments
6. Conclusion
- **特点**: 数据集和方法并列，工程化描述

### 完整模式 (NOVA 型，7 章)
1. Introduction
2. Related Work
3. Dataset Description
4. Benchmark Tasks
5. Experiments and Results
6. Discussion
7. Conclusion
- **特点**: 数据描述与任务定义分离，独立 Discussion 章节

## 二、Introduction 叙事策略

### 策略 A: 应用场景驱动 (OrthoLoC)
应用场景的重要性 → 现有方案缺陷 → 被忽视的替代方案 → 缺失的基础设施(数据集) → 贡献
- 关键词: "Surprisingly, no existing approach..."

### 策略 B: 成就肯定后转折 (RISEBench)
肯定已有成就 → 立即转折指出短板 → 承认前沿进展 → 指出评估空白 → 填补空白
- 关键词: "there is no well-established benchmark for..."

### 策略 C: 宏大问题漏斗 (NOVA)
全领域核心挑战 → 逐层聚焦到具体领域 → 逐个批评现有数据集 → 论证更广需求 → 解决方案
- 关键词: "No existing dataset reflects this full..."

### 共性: GAP 声明
所有 top papers 都包含一个明确的 "空白声明":
- "no existing..." / "there is no..." / "little attention has been given to..."
- 这是说服 reviewer 的核心武器

## 三、贡献陈述方式

### 编号列表 (最常见)
"Our contributions are summarized as follows: (1)... (2)... (3)..."
- 通常 3 条，不超过 4 条
- 每条以 "We" 开头 + 精确动词 (propose / introduce / conduct / establish)

### 叙事融入 (医学/交叉领域)
贡献自然嵌入 Introduction 叙述中，不单独列出
- 适用于领域传统偏叙事的论文

## 四、摘要四段式结构

| 成分 | 推荐占比 | 作用 |
|------|---------|------|
| 问题陈述 | 20-40% | 建立紧迫性和重要性 |
| 方案/数据集描述 | 30-45% | 展示核心贡献的具体内容 |
| 结果亮点 | 15-20% | 用数字制造冲击力 |
| 影响/可获取性 | 5-15% | 代码/数据公开声明 |

### 结果数字的呈现技巧:
- 用百分比提升: "up to 95% enhancement"
- 用绝对差距: "65% gap compared to natural image benchmarks"
- 用最强模型的低分: "even GPT-4o achieved only 28.8%"

## 五、数据集呈现的三种逻辑

### A. 按构建流程 (工程导向)
Data Acquisition → Data Processing → Data Pairing → Augmentation → Comparison
- 适合: 硬件采集型数据集

### B. 按分类体系 (任务导向)
Task Categories → Per-Category Design → Evaluation Dimensions
- 适合: Benchmark 评测型论文

### C. 按数据属性 (领域导向)
Composition → Annotation Process → Quality Control → Format & Access
- 适合: 需要强调标注质量的领域

## 六、实验设计亮点

1. **超越排名的分析**: 不仅仅比较 baseline 分数，还分析影响因素、失败模式
2. **压力测试命名**: "Stress Test" 比 "Experiment" 更有辨识度
3. **强模型的低分**: 故意选择 SOTA 模型，展示其低分来证明任务难度
4. **多维度评估**: 不只一个指标，通常 3-5 个维度
5. **人类/LLM 双评**: 对需要主观判断的任务，提供人类评估 + 自动评估的对比验证
