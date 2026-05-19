import { runPython } from '../pythonBridge';
import { callMCPTool, isMCPServerReady } from '../mcpClient';
import fs from 'fs';
import path from 'path';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, TableOfContents } from 'docx';

/* ================================================================
 * AI 工具定义 - 供 Function Calling 调用
 * ================================================================ */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

type ToolHandler = (args: Record<string, any>) => Promise<ToolResult>;

// ====== 工具定义 ======

// ====== eNSP 拓扑工具定义 ======
const enspTools: ToolDefinition[] = [
  {
    name: 'ensp_load_topology',
    description: '加载并解析 .topo 拓扑文件，返回拓扑结构（设备列表、连接关系、接口信息）。必须在分析拓扑前先调用此工具。',
    parameters: {
      type: 'object',
      properties: {
        filepath: { type: 'string', description: '.topo 文件的绝对路径（从拓扑上传结果中获取的 path 字段）' },
      },
      required: ['filepath'],
    },
  },
  {
    name: 'ensp_list_devices',
    description: '列出当前已加载拓扑中的所有设备（名称、型号、类型、com_port、接口列表），无需参数',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ensp_get_topology_info',
    description: '获取当前已加载拓扑的完整详细信息（全部设备、连接、标签），无需参数',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

export const toolDefinitions: ToolDefinition[] = [
  ...enspTools,
  // ====== MCP 工具（常驻进程，AI 原生对接） ======
  {
    name: 'mcp_configure_device',
    description: '【推荐】通过 MCP 方式在设备上执行配置命令。支持 Telnet/SSH，自动进入 system-view 视图，自动处理 save。基于 .topo 拓扑文件的设备名称。适用于配置 VLAN、OSPF、接口IP等。',
    parameters: {
      type: 'object',
      properties: {
        device_name: { type: 'string', description: '拓扑中的设备名称（如 AR1、LSW1、CE12800）' },
        commands: { type: 'array', items: { type: 'string' }, description: '配置命令列表（不要包含 system-view, save, return，系统自动处理）' },
        connection_method: { type: 'string', description: '连接方式：telent 或 ssh（默认 telnet）', default: 'telnet' },
        save_config: { type: 'boolean', description: '是否保存配置（默认 true）', default: true },
      },
      required: ['device_name', 'commands'],
    },
  },
  {
    name: 'mcp_show_device',
    description: '【推荐】通过 MCP 方式在设备上执行查询/查看命令。基于 .topo 拓扑文件的设备名称。适用于执行 display version, display interface brief 等查询命令。',
    parameters: {
      type: 'object',
      properties: {
        device_name: { type: 'string', description: '拓扑中的设备名称（如 AR1、LSW1）' },
        command: { type: 'string', description: '查询命令（如 display version, display interface brief）' },
        connection_method: { type: 'string', description: '连接方式：telnet 或 ssh（默认 telnet）', default: 'telnet' },
      },
      required: ['device_name', 'command'],
    },
  },
  {
    name: 'mcp_batch_configure',
    description: '【推荐】通过 MCP 方式批量配置多台设备。提供设备名称+命令的数组，支持 Telnet/SSH。',
    parameters: {
      type: 'object',
      properties: {
        devices: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '拓扑中的设备名称' },
              commands: { type: 'array', items: { type: 'string' }, description: '配置命令' },
            },
            required: ['name', 'commands'],
          },
          description: '设备配置数组 [{"name": "AR1", "commands": ["vlan 10"]}, ...]',
        },
        connection_method: { type: 'string', description: '连接方式', default: 'telnet' },
      },
      required: ['devices'],
    },
  },
  // ====== 传统工具 ======
  {
    name: 'get_devices',
    description: '获取所有设备列表，包括名称、IP、端口、设备类型、协议',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'run_backup',
    description: '对设备执行配置备份。如果指定 host 则备份单台，否则备份所有设备',
    parameters: {
      type: 'object',
      properties: {
        host: { type: 'string', description: '设备 IP（可选），不传则备份全部' },
      },
      required: [],
    },
  },
  {
    name: 'get_backup_list',
    description: '获取所有备份文件列表',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_backup_content',
    description: '读取指定备份文件的内容',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: '备份文件名' },
      },
      required: ['filename'],
    },
  },
  {
    name: 'run_inspect',
    description: '对设备执行自动化巡检。如果指定 host 则巡检单台，否则巡检所有设备',
    parameters: {
      type: 'object',
      properties: {
        host: { type: 'string', description: '设备 IP（可选），不传则巡检全部' },
      },
      required: [],
    },
  },
  {
    name: 'get_inspect_list',
    description: '获取所有巡检报告列表',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_file_content',
    description: '读取任意文件内容（如巡检报告、备份文件等）',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对路径' },
      },
      required: ['path'],
    },
  },
  {
    name: 'compare_configs',
    description: '对比两个备份文件的配置差异',
    parameters: {
      type: 'object',
      properties: {
        old_file: { type: 'string', description: '旧备份文件名' },
        new_file: { type: 'string', description: '新备份文件名' },
      },
      required: ['old_file', 'new_file'],
    },
  },
  {
    name: 'check_ping',
    description: 'Ping 检测目标主机的连通性',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '目标 IP 或域名' },
      },
      required: ['target'],
    },
  },
  {
    name: 'check_port',
    description: '检测目标主机的 TCP 端口是否开放',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '目标 IP 或域名' },
        port: { type: 'number', description: '端口号，默认 22' },
      },
      required: ['target'],
    },
  },
  {
    name: 'execute_command',
    description: '在设备上执行命令，支持查看信息、配置设备、备份保存等所有操作。自动处理视图切换（system-view/return），自动从 YAML 查询设备凭证。支持 SSH 和 Telnet。注意：Telnet 设备免账密登录，SSH 设备需要用户名密码。如果需要保存配置，可在 commands 中加 save 和 y。配置设备时（OSPF/VLAN/接口IP等）只需写业务命令，不要包含 system-view、sys、return、quit（系统自动处理）。',
    parameters: {
      type: 'object',
      properties: {
        host: { type: 'string', description: '设备 IP' },
        port: { type: 'number', description: '设备端口号（SSH 默认 22，Telnet 默认 23，eNSP 设备使用 2000-2005 等端口）' },
        command: { type: 'string', description: '单条命令（与 commands 二选一，查看信息时用）' },
        commands: { type: 'array', items: { type: 'string' }, description: '多条命令数组（与 command 二选一，配置设备或批量执行时用）。系统自动判断每条命令的视图并处理切换，只需按逻辑顺序写业务命令。' },
      },
      required: ['host'],
    },
  },
  // ====== 文件导出工具定义 ======
  {
    name: 'export_to_markdown',
    description: '将 AI 回答内容导出为 Markdown (.md) 文件',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '要导出的内容文本（原始 Markdown 格式）' },
      },
      required: ['content'],
    },
  },
  {
    name: 'export_to_html',
    description: '将 AI 回答内容导出为 HTML (.html) 文件，包含美观的样式和代码高亮',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '要导出的内容文本（Markdown 格式，会自动转换为 HTML）' },
      },
      required: ['content'],
    },
  },
  {
    name: 'export_to_docx',
    description: '将 AI 回答内容导出为 Word (.docx) 文件，保留标题、代码块、列表等格式',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '要导出的内容文本（Markdown 格式，会自动转换为 DOCX）' },
      },
      required: ['content'],
    },
  },
];

// ====== 导出工具辅助函数 ======

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const EXPORT_DIR = path.join(PROJECT_ROOT, 'exports');

// 确保导出目录存在
if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

/** 简单的 Markdown 转 HTML（支持标题、代码块、表格、列表、粗体、行内代码） */
function mdToHtml(md: string): string {
  let html = md
    // 代码块 ``` ``` 先保护起来
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
      const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre><code>${escaped.trim()}</code></pre>`;
    })
    // Markdown 表格：| col1 | col2 | ... |
    .replace(/^\|(.+)\|\s*?\n\|[-| :]+\|\s*?\n((?:\|.+\|\s*?\n?)+)/gm, (match, headerLine, bodyLines) => {
      const headers = headerLine.split('|').map(c => c.trim()).filter(c => c !== '');
      const rows = bodyLines.trim().split('\n')
        .filter(line => line.trim().startsWith('|'))
        .map(line => line.split('|').map(c => c.trim()).filter(c => c !== ''));
      let table = '<table><thead><tr>';
      headers.forEach(h => { table += `<th>${h}</th>`; });
      table += '</tr></thead><tbody>';
      rows.forEach(row => {
        table += '<tr>';
        row.forEach(cell => { table += `<td>${cell}</td>`; });
        table += '</tr>';
      });
      table += '</tbody></table>';
      return table;
    })
    // 标题
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // 粗体
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // 行内代码
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // 无序列表
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // 有序列表
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // 水平线
    .replace(/^---$/gm, '<hr>')
    // 段落（连续两行换行）
    .replace(/\n\n/g, '</p><p>')
    // 换行
    .replace(/\n/g, '<br>');

  html = `<p>${html}</p>`;
  // 将连续的 <li> 包裹到 <ul>/<ol> 中
  html = html.replace(/((?:<li>.*?<\/li><br>?)+)/g, '<ul>$1</ul>');
  // 清理空标签
  html = html.replace(/<p><\/p>/g, '').replace(/<br><\/li>/g, '</li>');

  return html;
}

/** 解析 Markdown 内容并生成 docx Paragraph 数组 */
function mdToDocxParagraphs(md: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const lines = md.split('\n');
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 代码块
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        paragraphs.push(
          new Paragraph({
            spacing: { before: 200, after: 200 },
            indent: { left: 400 },
            children: [new TextRun({ text: codeBuffer.join('\n'), font: 'Courier New', size: 18 })],
          })
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // 跳过空行
    if (!trimmed) {
      paragraphs.push(new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: '' })] }));
      continue;
    }

    // 标题
    const h1Match = trimmed.match(/^# (.+)/);
    const h2Match = trimmed.match(/^## (.+)/);
    const h3Match = trimmed.match(/^### (.+)/);
    if (h1Match) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 300, after: 200 },
          children: [new TextRun({ text: h1Match[1], bold: true, size: 32 })],
        })
      );
      continue;
    }
    if (h2Match) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 250, after: 150 },
          children: [new TextRun({ text: h2Match[1], bold: true, size: 26 })],
        })
      );
      continue;
    }
    if (h3Match) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
          children: [new TextRun({ text: h3Match[1], bold: true, size: 22 })],
        })
      );
      continue;
    }

    // 列表项
    const listMatch = trimmed.match(/^[-*]\s+(.+)/);
    const olMatch = trimmed.match(/^\d+\.\s+(.+)/);
    if (listMatch || olMatch) {
      const text = listMatch ? listMatch[1] : olMatch![1];
      paragraphs.push(
        new Paragraph({
          spacing: { before: 60, after: 60 },
          indent: { left: 400, hanging: 200 },
          bullet: { level: 0 },
          children: [new TextRun({ text, size: 20 })],
        })
      );
      continue;
    }

    // 水平线
    if (/^---$/.test(trimmed)) {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 200, after: 200 },
          border: { bottom: { style: 'single', size: 6, space: 1 } },
          children: [new TextRun({ text: '' })],
        })
      );
      continue;
    }

    // 普通文本（处理粗体、代码）
    const runs: TextRun[] = [];
    // 按粗体分割
    const boldParts = trimmed.split(/(\*\*.+?\*\*)/);
    for (const part of boldParts) {
      const boldMatch = part.match(/^\*\*(.+)\*\*$/);
      if (boldMatch) {
        runs.push(new TextRun({ text: boldMatch[1], bold: true, size: 20 }));
      } else {
        // 行内代码
        const codeParts = part.split(/(`[^`]+`)/);
        for (const cp of codeParts) {
          const codeMatch = cp.match(/^`([^`]+)`$/);
          if (codeMatch) {
            runs.push(new TextRun({ text: codeMatch[1], font: 'Courier New', size: 18 }));
          } else {
            runs.push(new TextRun({ text: cp, size: 20 }));
          }
        }
      }
    }
    paragraphs.push(new Paragraph({ spacing: { before: 80, after: 80 }, children: runs }));
  }

  // 剩余代码块内容
  if (codeBuffer.length > 0) {
    paragraphs.push(
      new Paragraph({
        spacing: { before: 200, after: 200 },
        indent: { left: 400 },
        children: [new TextRun({ text: codeBuffer.join('\n'), font: 'Courier New', size: 18 })],
      })
    );
  }

  return paragraphs;
}

// ====== 工具执行器 ======

async function callPython(...args: string[]): Promise<ToolResult> {
  try {
    const output = await runPython('api/runner.py', args);
    return JSON.parse(output);
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export const toolHandlers: Record<string, ToolHandler> = {
  get_devices: async () => {
    return callPython('devices');
  },

  run_backup: async (args) => {
    if (args.host) {
      return callPython('backup_run_device', args.host);
    }
    return callPython('backup_run');
  },

  get_backup_list: async () => {
    return callPython('backup_list');
  },

  get_backup_content: async (args) => {
    return callPython('backup_content', args.filename);
  },

  run_inspect: async (args) => {
    if (args.host) {
      return callPython('inspect_run_device', args.host);
    }
    return callPython('inspect_run');
  },

  get_inspect_list: async () => {
    return callPython('inspect_list');
  },

  get_file_content: async (args) => {
    // 安全校验：只允许读取 backups/ 和 reports/ 目录中的文件
    const allowedDirs = ['backups', 'reports'];
    const isAllowed = allowedDirs.some(dir => args.path.includes(dir));
    if (!isAllowed) {
      return { success: false, error: '不允许读取该路径下的文件' };
    }
    return callPython('read_file', args.path);
  },

  compare_configs: async (args) => {
    return callPython('diff_compare', args.old_file, args.new_file);
  },

  check_ping: async (args) => {
    return callPython('ping', args.target);
  },

  check_port: async (args) => {
    return callPython('port', args.target, String(args.port || 22));
  },

  execute_command: async (args) => {
    try {
      // 检查端口参数（同IP多设备时必须传port）
      if (!args.port) {
        const devList = await callPython('devices');
        const sameHost = (devList.data || []).filter((d: any) => d.host === args.host);
        if (sameHost.length > 1) {
          return {
            success: false,
            error: `设备 ${args.host} 存在多个实例（端口: ${sameHost.map((d:any)=>d.port).join(', ')}），请指定 port 参数`
          };
        }
        if (sameHost.length === 1) {
          args.port = sameHost[0].port;
        }
      }

      const credArgs = Buffer.from(JSON.stringify([args.host, String(args.port || '0')])).toString('base64');
      const credRes = await callPython('device_credentials', credArgs);
      if (!credRes.success) return credRes;
      const device = credRes.data;

      // 批量模式：使用视图感知执行
      if (args.commands && Array.isArray(args.commands)) {
        return callPython(
          'ssh_connect_batch',
          args.host,
          device.username || '',
          device.password || '',
          device.device_type || 'huawei',
          JSON.stringify(args.commands),
          String(device.port || 22),
          device.protocol || 'ssh'
        );
      }
      // 单条命令模式
      return callPython(
        'ssh_connect',
        args.host,
        device.username || '',
        device.password || '',
        device.device_type || 'huawei',
        args.command || '',
        String(device.port || 22),
        device.protocol || 'ssh'
      );
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  // ====== eNSP 拓扑工具执行器 ======

  ensp_load_topology: async (args) => {
    // 尝试 MCP 方式
    if (isMCPServerReady()) {
      try {
        const result = await callMCPTool('load-topology', { topo_file: args.filepath });
        return { success: true, data: result };
      } catch (e: any) {
        console.warn(`[MCP] load-topology 失败，回退到 Python Bridge: ${e.message}`);
      }
    }
    return callPython('ensp_load_topology', args.filepath);
  },

  ensp_list_devices: async () => {
    if (isMCPServerReady()) {
      try {
        const result = await callMCPTool('list-devices');
        return { success: true, data: result };
      } catch (e: any) {
        console.warn(`[MCP] list-devices 失败，回退: ${e.message}`);
      }
    }
    return callPython('ensp_list_devices');
  },

  ensp_get_topology_info: async () => {
    if (isMCPServerReady()) {
      try {
        const result = await callMCPTool('get-topology-info');
        return { success: true, data: result };
      } catch (e: any) {
        console.warn(`[MCP] get-topology-info 失败，回退: ${e.message}`);
      }
    }
    return callPython('ensp_get_topology_info');
  },

  // ====== MCP 工具执行器（常驻进程，高性能） ======

  mcp_configure_device: async (args) => {
    try {
      const result = await callMCPTool('configure-device-by-name', {
        device_name: args.device_name,
        commands: args.commands,
        connection_method: args.connection_method || 'telnet',
        save_config: args.save_config !== false,
      });
      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  mcp_show_device: async (args) => {
    try {
      const result = await callMCPTool('show-device-by-name', {
        device_name: args.device_name,
        command: args.command,
        connection_method: args.connection_method || 'telnet',
      });
      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  mcp_batch_configure: async (args) => {
    try {
      const result = await callMCPTool('batch-configure', {
        devices: args.devices,
        connection_method: args.connection_method || 'telnet',
      });
      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  // ====== 文件导出处理器（供前端直接调用，非 AI 自主调用） ======

  export_to_markdown: async (args) => {
    try {
      const content = args.content || '';
      const timestamp = Date.now();
      const filename = `export_${timestamp}.md`;
      const filepath = path.join(EXPORT_DIR, filename);
      fs.writeFileSync(filepath, content, 'utf-8');
      return { success: true, data: { filename, path: filepath.replace(/\\/g, '/') } };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  export_to_html: async (args) => {
    try {
      const content = args.content || '';
      const timestamp = Date.now();
      const filename = `export_${timestamp}.html`;
      const filepath = path.join(EXPORT_DIR, filename);
      const mdContent = mdToHtml(content);
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NetOps AI 导出报告</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', 'Noto Sans SC', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.7; color: #333; }
  h1 { border-bottom: 2px solid #1a73e8; padding-bottom: 8px; color: #1a73e8; }
  h2 { border-bottom: 1px solid #ddd; padding-bottom: 6px; color: #2c3e50; }
  h3 { color: #34495e; }
  pre { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 4px; padding: 12px; overflow-x: auto; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  ul, ol { padding-left: 24px; }
  li { margin: 4px 0; }
  blockquote { border-left: 4px solid #1a73e8; margin: 12px 0; padding: 8px 16px; background: #f8f9fa; }
  hr { border: none; border-top: 1px solid #ddd; margin: 24px 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 0.9em; }
  th, td { border: 1px solid #d0d0d0; padding: 8px 12px; text-align: left; }
  th { background: #1a73e8; color: #fff; font-weight: 600; white-space: nowrap; }
  tr:nth-child(even) { background: #f8f9fa; }
  tr:hover { background: #e8f0fe; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; font-size: 0.85em; color: #888; text-align: center; }
</style>
</head>
<body>
${mdContent}
<div class="footer">由 NetOps AI 运维助手生成 · ${new Date().toLocaleString('zh-CN')}</div>
</body>
</html>`;
      fs.writeFileSync(filepath, html, 'utf-8');
      return { success: true, data: { filename, path: filepath.replace(/\\/g, '/') } };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  export_to_docx: async (args) => {
    try {
      const content = args.content || '';
      const timestamp = Date.now();
      const filename = `export_${timestamp}.docx`;
      const filepath = path.join(EXPORT_DIR, filename);
      const paragraphs = mdToDocxParagraphs(content);
      const doc = new Document({
        title: 'NetOps AI 导出报告',
        description: '由 NetOps AI 运维助手生成',
        styles: {
          default: {
            document: {
              run: { font: 'Microsoft YaHei', size: 20 },
            },
          },
        },
        sections: [{ children: paragraphs }],
      });
      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(filepath, buffer);
      return { success: true, data: { filename, path: filepath.replace(/\\/g, '/') } };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },
};
