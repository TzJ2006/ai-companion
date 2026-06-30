# NeurIPS 2025 Dataset Track - Spotlight Papers (56 篇，此处列出关键样本)

## 类别一: LLM/Agent 评测 Benchmark
| 论文 | 核心卖点 | 写作亮点 |
|------|---------|---------|
| Why Do Multi-Agent LLM Systems Fail? | 1600+ 标注 traces, 14 failure modes, κ=0.88 | 问题型标题，提出完整 failure taxonomy |
| MME | 14 subtasks, 30 MLLMs 评测, 手动标注避免数据泄露 | 强调手动标注的 fairness |
| ResearchCodeBench | 30+ LLMs, 最强<40%, 来自 2024-2025 top papers | 强调 "novel ideas unseen during pretraining" |
| SWE-smith | 50k instances, 128 repos, SWE-agent-LM-32B SOTA 40.2% | 数据集+训练+模型的完整生态 |
| Absence Bench | LLMs Can't See What's Missing | 揭示 Transformer 架构的根本性局限 |
| SciArena | 44 models, 19,000+ votes, community-driven | 引入 Chatbot Arena 范式到科学评测 |
| AGENTIF | Agent 指令遵循评测 | 垂直领域的系统评测 |
| MMLongBench | 长上下文 VLM 评测 | 聚焦被忽视的长上下文能力 |

## 类别二: 数据/系统工具
| 论文 | 核心卖点 | 写作亮点 |
|------|---------|---------|
| Data-Juicer 2.0 | 100+ operators, TB-level, 10k+ CPU cores | 系统论文范式: 功能+性能+可扩展性+社区采用 |
| Gymnasium | RL 标准接口, Farama Foundation | 强调标准化的长期价值而非短期 SOTA |
| TabArena | Living benchmark, 持续维护 | "Living benchmark" 概念创新 |
| Reasoning Gym | 100+ tasks, 无限数据生成, 可调难度 | 程序化生成作为核心优势 |
| Torch-Uncertainty | DL 不确定性量化库 | 工具论文: 统一框架+易用性+可扩展性 |

## 类别三: 跨学科/社会影响
| 论文 | 核心卖点 | 写作亮点 |
|------|---------|---------|
| CoralVQA (Oral) | AI + 珊瑚礁保护 | 跨学科合作的叙事力量 |
| TIDMAD | AI + 暗物质探测 | "85% of matter is dark matter" 的宏大开场 |
| Bubbleformer | Transformer + 沸腾预测 | 物理 metric 创新 (热通量/界面几何/质量守恒) |
| Thousand Voices of Trauma | 合成心理治疗数据 | 隐私保护 + 临床专家验证 |
| Open-Insect | 生物多样性监测 | 地理跨域泛化的独特视角 |

## 类别四: 专注数据集
| 论文 | 核心卖点 | 写作亮点 |
|------|---------|---------|
| BEDLAM2.0 (Oral) | 合成人体运动数据 v2 | 升级型数据集的范式 |
| V2X-Radar | 4D 雷达多模态 | 硬件+场景多样性 |
| The Temporal Graph of Bitcoin | 2.4B nodes, 39.72B edges | 纯粹的数据规模冲击力 |
| EuroSpeech | 多语种语音语料 | 强调语言多样性和代表性 |

## 写作模式共性

### 1. 摘要中的数字密度
Spotlight 论文的摘要平均包含 5-8 个关键数字:
- 数据集规模 (samples, images, QA pairs)
- 覆盖范围 (categories, languages, models evaluated)
- 核心性能指标 (accuracy, F1, gap)

### 2. "Benchmark + Insight" 双重贡献
最成功的 Spotlight 论文不只是提供 benchmark，还提供 **actionable insights**:
- "Why Do Multi-Agent LLM Systems Fail?" → failure taxonomy + improvement roadmap
- "Fixing It in Post" → TuluTalk (14% fewer samples, same/better performance)
- "Measuring Fingerprints" → fingerprints propagate through training

### 3. 标题中的品牌意识
成功的论文为 benchmark/dataset 创建了有辨识度的品牌名:
- 有意义的缩写: MME, MAST, NOVA
- 有创意的命名: Bubbleformer, Artificial Hivemind, Absence Bench
- 实用的命名: SWE-smith, Data-Juicer, TabArena

### 4. 补充材料的重要性
Spotlight 和 Oral 论文普遍有丰富的附录:
- 完整实验表格
- 数据集样本展示
- 标注指南详情
- 更多分析维度
