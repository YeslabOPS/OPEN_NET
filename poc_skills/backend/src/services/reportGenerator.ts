/**
 * 巡检报告生成服务 (OP14)
 * 生成结构化 Markdown 格式的巡检报告
 */

import * as fs from 'fs';
import * as path from 'path';
import { DeviceInspectionResult } from './types.js';

// 报告存储目录
const REPORT_DIR = path.join(process.cwd(), 'data', 'reports');

// 确保目录存在
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 格式化时间
function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// 格式化时长
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

// 生成报告内容
export function generateReportContent(
  results: DeviceInspectionResult[],
  metadata: {
    templateName?: string;
    agentName?: string;
    startTime: Date;
    endTime: Date;
  }
): string {
  const { startTime, endTime, templateName, agentName } = metadata;
  const duration = endTime.getTime() - startTime.getTime();

  // 统计信息
  const totalDevices = results.length;
  const successDevices = results.filter(r => r.success).length;
  const failedDevices = totalDevices - successDevices;
  const totalCommands = results.reduce((sum, r) => sum + r.commands.length, 0);
  const successCommands = results.reduce(
    (sum, r) => sum + r.commands.filter(c => c.exitCode === 0).length,
    0
  );

  let content = '';

  // 报告头部
  content += '# 📋 网络设备巡检报告\n\n';
  content += `---\n\n`;
  content += `**生成时间**: ${formatDate(new Date())}\n\n`;
  if (templateName) content += `**模板名称**: ${templateName}\n\n`;
  if (agentName) content += `**巡检 Agent**: ${agentName}\n\n`;
  content += `---\n\n`;

  // 执行摘要
  content += `## 📊 执行摘要\n\n`;
  content += `| 指标 | 数值 |\n`;
  content += `|:-----|-----:|\n`;
  content += `| 巡检设备数 | ${totalDevices} |\n`;
  content += `| 成功设备数 | ${successDevices} |\n`;
  content += `| 失败设备数 | ${failedDevices} |\n`;
  content += `| 执行命令数 | ${totalCommands} |\n`;
  content += `| 成功命令数 | ${successCommands} |\n`;
  content += `| 执行时长 | ${formatDuration(duration)} |\n`;
  content += `| 开始时间 | ${formatDate(startTime)} |\n`;
  content += `| 结束时间 | ${formatDate(endTime)} |\n\n`;

  // 设备巡检结果
  content += `## 🔍 设备巡检详情\n\n`;

  for (const result of results) {
    const statusIcon = result.success ? '✅' : '❌';
    content += `### ${statusIcon} ${result.device} (${result.deviceType})\n\n`;

    if (result.error) {
      content += `> **连接错误**: ${result.error}\n\n`;
      continue;
    }

    // 设备统计
    const cmdSuccess = result.commands.filter(c => c.exitCode === 0).length;
    content += `| 命令成功数 | 执行时长 |\n`;
    content += `|:----------|:--------|\n`;
    content += `| ${cmdSuccess}/${result.commands.length} | ${formatDuration(
      result.commands.reduce((sum, c) => sum + c.duration, 0)
    )} |\n\n`;

    // 命令输出
    content += `#### 命令执行结果\n\n`;

    for (const cmd of result.commands) {
      const cmdIcon = cmd.exitCode === 0 ? '✅' : '❌';
      content += `**${cmdIcon} \`${cmd.command}\`** (${formatDuration(cmd.duration)})\n\n`;

      if (cmd.stdout) {
        content += '```\n';
        content += cmd.stdout.trim();
        content += '\n```\n\n';
      }

      if (cmd.stderr) {
        content += '> ⚠️ stderr:\n';
        content += '```\n';
        content += cmd.stderr.trim();
        content += '\n```\n\n';
      }
    }

    content += '---\n\n';
  }

  // 页脚
  content += `---\n\n`;
  content += `*本报告由 NetOps Agent Skills 自动生成*\n`;

  return content;
}

// 保存报告到文件
export async function saveReport(
  recordId: string,
  content: string
): Promise<string> {
  ensureDir(REPORT_DIR);

  const filename = `${recordId}_${Date.now()}.md`;
  const filePath = path.join(REPORT_DIR, filename);

  await fs.promises.writeFile(filePath, content, 'utf-8');

  // 返回相对于 data 目录的路径
  return path.join('data', 'reports', filename);
}

// 读取报告内容
export async function readReport(filePath: string): Promise<string> {
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`报告文件不存在: ${filePath}`);
  }

  return fs.promises.readFile(fullPath, 'utf-8');
}

// 删除报告
export async function deleteReport(filePath: string): Promise<void> {
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  if (fs.existsSync(fullPath)) {
    await fs.promises.unlink(fullPath);
  }
}
