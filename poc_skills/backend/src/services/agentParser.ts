/**
 * Agent 报告解析服务 (OP22)
 * 调用 DeepSeek API 进行巡检报告智能分析
 */

import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../lib/prisma.js';
import { deepseekService, Message } from './deepseek.js';
import { readReport } from './reportGenerator.js';

// 基线文档存储目录
const BASELINE_DIR = path.join(process.cwd(), 'data', 'baselines');

// 确保目录存在
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 获取 Agent 的系统提示词
async function getAgentSystemPrompt(agentId: string): Promise<string> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
  });
  return agent?.systemPrompt || '';
}

// 获取模板信息
async function getTemplateInfo(templateId: string) {
  return prisma.inspectionTemplate.findUnique({
    where: { id: templateId },
  });
}

// 检查模板是否已有活跃基线
export async function hasActiveBaseline(templateId: string): Promise<boolean> {
  const baseline = await prisma.baselineDocument.findFirst({
    where: {
      templateId,
      isActive: true,
    },
  });
  return !!baseline;
}

// 获取当前活跃基线
export async function getActiveBaseline(templateId: string) {
  return prisma.baselineDocument.findFirst({
    where: {
      templateId,
      isActive: true,
    },
  });
}

// 读取基线文档内容
export async function readBaseline(filePath: string): Promise<string> {
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`基线文档不存在: ${filePath}`);
  }

  return fs.promises.readFile(fullPath, 'utf-8');
}

// 分析报告（无基线对比）
export async function analyzeReport(
  reportContent: string,
  agentId: string,
  templateInfo?: { name?: string; deviceType?: string; description?: string }
): Promise<{ analysis: string; summary: object }> {
  const systemPrompt = await getAgentSystemPrompt(agentId);
  
  const deviceType = templateInfo?.deviceType || 'generic';
  const templateName = templateInfo?.name || '未命名模板';

  const messages: Message[] = [
    {
      role: 'system',
      content: `${systemPrompt}

你是网络设备运维专家，负责分析巡检报告并提供专业的运维建议。

## 职责
- 分析巡检结果，发现潜在问题
- 识别配置异常和性能瓶颈
- 提供具体的修复建议
- 评估设备健康状态

## 输出要求
1. 简洁专业的分析报告
2. 问题按严重程度分类
3. 提供可操作的建议`,
    },
    {
      role: 'user',
      content: `请分析以下网络设备巡检报告：

**模板**: ${templateName}
**设备类型**: ${deviceType}

---

${reportContent}

---

请提供：
1. 整体健康状态评估
2. 发现的问题（如果有）
3. 修复建议`,
    },
  ];

  try {
    const response = await deepseekService.chat({
      messages,
      temperature: 0.3,
      maxTokens: 4096,
    });

    const analysis = response.choices[0]?.message?.content || '';

    // 生成摘要
    const summary = {
      analyzedAt: new Date().toISOString(),
      hasIssues: analysis.toLowerCase().includes('问题') || analysis.toLowerCase().includes('异常'),
      hasWarnings: analysis.toLowerCase().includes('警告') || analysis.toLowerCase().includes('建议'),
    };

    return { analysis, summary };
  } catch (error) {
    console.error('Agent analysis error:', error);
    throw new Error(`Agent 分析失败: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// 生成基线文档
export async function generateBaseline(
  reportContent: string,
  agentId: string,
  templateId: string
): Promise<{ filePath: string; version: number }> {
  const systemPrompt = await getAgentSystemPrompt(agentId);
  const template = await getTemplateInfo(templateId);

  if (!template) {
    throw new Error(`模板不存在: ${templateId}`);
  }

  const deviceType = template.deviceType;
  const templateName = template.name;

  // 获取当前最大版本号
  const latestBaseline = await prisma.baselineDocument.findFirst({
    where: { templateId },
    orderBy: { version: 'desc' },
  });
  const newVersion = (latestBaseline?.version || 0) + 1;

  // 确保目录存在
  const templateDir = path.join(BASELINE_DIR, templateId);
  ensureDir(templateDir);

  const messages: Message[] = [
    {
      role: 'system',
      content: `${systemPrompt}

你是网络设备运维专家，负责根据巡检报告生成配置基线文档。

## 职责
- 分析当前巡检报告中的设备配置
- 提取关键配置参数作为基线
- 生成结构化的基线文档

## 基线文档格式要求
生成的基线文档应包含以下结构：

\`\`\`markdown
# [设备类型] 配置基线

## 基线信息
- 版本: vX
- 生成时间: YYYY-MM-DD
- 适用设备类型: [设备类型]
- 模板: [模板名称]

## 关键配置项

### 1. [配置类别名称]
| 参数 | 期望值 | 说明 |
|:-----|:------|:-----|
| [参数1] | [值或范围] | [说明] |
| [参数2] | [值或范围] | [说明] |

### 2. [配置类别名称]
...

## 安全基线要求
- [具体安全要求]

## 性能基线要求
- [具体性能要求]

## 告警阈值
- [告警条件]
\`\`\`

## 重要提示
- 只记录当前报告中明确存在的配置项
- 不要虚构配置参数
- 使用简洁的技术语言`,
    },
    {
      role: 'user',
      content: `请根据以下巡检报告生成配置基线文档：

**模板**: ${templateName}
**设备类型**: ${deviceType}

---

${reportContent}

---

请严格按照指定的格式生成基线文档。`,
    },
  ];

  try {
    const response = await deepseekService.chat({
      messages,
      temperature: 0.3,
      maxTokens: 8192,
    });

    let baselineContent = response.choices[0]?.message?.content || '';

    // 清理 markdown 代码块
    if (baselineContent.startsWith('```markdown')) {
      baselineContent = baselineContent.replace(/^```markdown\n/, '').replace(/\n```$/, '');
    } else if (baselineContent.startsWith('```')) {
      baselineContent = baselineContent.replace(/^```\n/, '').replace(/\n```$/, '');
    }

    // 保存基线文档
    const filename = `baseline_v${newVersion}.md`;
    const filePath = path.join(templateDir, filename);
    await fs.promises.writeFile(filePath, baselineContent, 'utf-8');

    // 更新数据库
    // 先将旧的活跃基线设为非活跃
    await prisma.baselineDocument.updateMany({
      where: { templateId, isActive: true },
      data: { isActive: false },
    });

    // 创建新基线记录
    await prisma.baselineDocument.create({
      data: {
        templateId,
        filePath: path.join('data', 'baselines', templateId, filename),
        version: newVersion,
        isActive: true,
      },
    });

    return {
      filePath: path.join('data', 'baselines', templateId, filename),
      version: newVersion,
    };
  } catch (error) {
    console.error('Generate baseline error:', error);
    throw new Error(`基线生成失败: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// 基线对比分析
export async function analyzeWithBaseline(
  reportContent: string,
  baselineContent: string,
  agentId: string,
  templateInfo?: { name?: string; deviceType?: string }
): Promise<{ analysis: string; deviations: object }> {
  const systemPrompt = await getAgentSystemPrompt(agentId);

  const deviceType = templateInfo?.deviceType || 'generic';
  const templateName = templateInfo?.name || '未命名模板';

  const messages: Message[] = [
    {
      role: 'system',
      content: `${systemPrompt}

你是网络设备运维专家，负责对比当前巡检报告与基线文档，分析偏差并给出建议。

## 职责
- 严格对比当前配置与基线配置
- 识别所有偏差项（无论大小）
- 评估偏差的严重程度
- 提供修复建议

## 输出格式

### 偏差分析报告

#### 整体状态
[与基线的符合程度评分 0-100%]

#### 发现偏差
| 偏差项 | 基线值 | 当前值 | 严重程度 | 建议 |
|:-------|:-------|:-------|:---------|:-----|
| [参数] | [值] | [值] | 高/中/低 | [建议] |

#### 符合基线的项目
- [符合的配置项列表]

#### 总体建议
[后续行动建议]`,
    },
    {
      role: 'user',
      content: `请对比当前巡检报告与基线文档，分析偏差：

**模板**: ${templateName}
**设备类型**: ${deviceType}

---

## 基线文档

${baselineContent}

---

## 当前巡检报告

${reportContent}

---

请提供详细的偏差分析。`,
    },
  ];

  try {
    const response = await deepseekService.chat({
      messages,
      temperature: 0.3,
      maxTokens: 4096,
    });

    const analysis = response.choices[0]?.message?.content || '';

    // 解析偏差信息（简化处理）
    const deviations = {
      analyzedAt: new Date().toISOString(),
      hasDeviations: analysis.toLowerCase().includes('偏差') || analysis.toLowerCase().includes('异常'),
      hasCriticalIssues: analysis.toLowerCase().includes('严重') || analysis.toLowerCase().includes('高风险'),
    };

    return { analysis, deviations };
  } catch (error) {
    console.error('Baseline analysis error:', error);
    throw new Error(`基线对比分析失败: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// 重新生成基线
export async function regenerateBaseline(
  templateId: string,
  latestReportContent: string,
  agentId: string
): Promise<{ filePath: string; version: number }> {
  return generateBaseline(latestReportContent, agentId, templateId);
}

// 获取基线历史版本
export async function getBaselineHistory(templateId: string) {
  return prisma.baselineDocument.findMany({
    where: { templateId },
    orderBy: { version: 'desc' },
  });
}
