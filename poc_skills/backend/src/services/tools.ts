// ============================================================
// 网络设备工具服务
// 实现 SSH 连接、CLI 执行、输出解析等功能
// ============================================================

import { Client as SSHClient, ConnectConfig } from 'ssh2';
import { Readable } from 'stream';

// SSH 连接配置
export interface SSHConnectionConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

// 命令执行结果
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number; // ms
}

// 巡检结果
export interface InspectionResult {
  device: string;
  success: boolean;
  commands: {
    command: string;
    result: CommandResult;
    parsed?: Record<string, any>;
  }[];
  summary?: string;
  timestamp: Date;
}

// SSH 连接管理器
export class SSHConnection {
  private client: SSHClient;
  private connected: boolean = false;
  private config: SSHConnectionConfig;

  constructor(config: SSHConnectionConfig) {
    this.config = config;
    this.client = new SSHClient();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port || 22,
        username: this.config.username,
        readyTimeout: 30000,
      };

      if (this.config.password) {
        connectConfig.password = this.config.password;
      } else if (this.config.privateKey) {
        connectConfig.privateKey = this.config.privateKey;
        if (this.config.passphrase) {
          connectConfig.passphrase = this.config.passphrase;
        }
      }

      this.client.on('ready', () => {
        this.connected = true;
        resolve();
      });

      this.client.on('error', (err) => {
        this.connected = false;
        reject(new Error(`SSH connection error: ${err.message}`));
      });

      this.client.on('close', () => {
        this.connected = false;
      });

      try {
        this.client.connect(connectConfig);
      } catch (err: any) {
        reject(new Error(`Failed to initiate SSH connection: ${err.message}`));
      }
    });
  }

  async executeCommand(command: string, timeout: number = 30000): Promise<CommandResult> {
    if (!this.connected) {
      throw new Error('Not connected to SSH server');
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      this.client.exec(command, (err, stream) => {
        if (err) {
          resolve({
            stdout: '',
            stderr: err.message,
            exitCode: -1,
            duration: Date.now() - startTime,
          });
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code: number) => {
          resolve({
            stdout,
            stderr,
            exitCode: code,
            duration: Date.now() - startTime,
          });
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        // 设置超时
        setTimeout(() => {
          stream.end();
          resolve({
            stdout,
            stderr: stderr || 'Command timed out',
            exitCode: -1,
            duration: Date.now() - startTime,
          });
        }, timeout);
      });
    });
  }

  async executeCommands(commands: string[], timeout: number = 30000): Promise<CommandResult[]> {
    const results: CommandResult[] = [];
    for (const cmd of commands) {
      const result = await this.executeCommand(cmd, timeout);
      results.push(result);
    }
    return results;
  }

  disconnect(): void {
    this.client.end();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * 测试 SSH 连接
 */
export async function testSSHConnection(config: SSHConnectionConfig): Promise<{
  success: boolean;
  message: string;
  latency?: number;
}> {
  const startTime = Date.now();
  const ssh = new SSHConnection(config);

  try {
    await ssh.connect();
    const latency = Date.now() - startTime;
    ssh.disconnect();
    return {
      success: true,
      message: 'SSH 连接成功',
      latency,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'SSH 连接失败',
    };
  }
}

// 工具注册表
export interface ToolHandler {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
  execute: (params: Record<string, any>) => Promise<any>;
}

// 工具执行器
export class ToolExecutor {
  private tools: Map<string, ToolHandler> = new Map();

  constructor() {
    this.registerDefaultTools();
  }

  // 注册默认工具
  private registerDefaultTools(): void {
    // SSH 连接工具
    this.register({
      name: 'connect_device',
      description: '建立与网络设备的 SSH 连接',
      parameters: {
        type: 'object',
        properties: {
          host: { type: 'string', description: '设备 IP 地址' },
          port: { type: 'number', description: 'SSH 端口，默认 22', default: 22 },
          username: { type: 'string', description: '登录用户名' },
          password: { type: 'string', description: '登录密码（可选）' },
          privateKey: { type: 'string', description: '私钥内容（可选）' },
        },
        required: ['host', 'username'],
      },
      execute: async (params) => {
        const conn = new SSHConnection(params);
        await conn.connect();
        return { success: true, message: `已连接到 ${params.host}` };
      },
    });

    // 执行命令工具
    this.register({
      name: 'execute_command',
      description: '在已连接的设备上执行 CLI 命令',
      parameters: {
        type: 'object',
        properties: {
          host: { type: 'string', description: '设备 IP 地址' },
          port: { type: 'number', description: 'SSH 端口，默认 22' },
          username: { type: 'string', description: '登录用户名' },
          password: { type: 'string', description: '登录密码（可选）' },
          privateKey: { type: 'string', description: '私钥内容（可选）' },
          command: { type: 'string', description: '要执行的命令' },
          timeout: { type: 'number', description: '超时时间（毫秒），默认 30000' },
        },
        required: ['host', 'username', 'command'],
      },
      execute: async (params) => {
        const { command, timeout, ...sshConfig } = params;
        const conn = new SSHConnection(sshConfig);
        
        try {
          await conn.connect();
          const result = await conn.executeCommand(command, timeout || 30000);
          conn.disconnect();
          
          return {
            success: result.exitCode === 0,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            duration: result.duration,
          };
        } catch (err: any) {
          conn.disconnect();
          throw new Error(`执行命令失败: ${err.message}`);
        }
      },
    });

    // 批量执行命令工具
    this.register({
      name: 'execute_batch_commands',
      description: '在设备上批量执行多个 CLI 命令',
      parameters: {
        type: 'object',
        properties: {
          host: { type: 'string', description: '设备 IP 地址' },
          port: { type: 'number', description: 'SSH 端口，默认 22' },
          username: { type: 'string', description: '登录用户名' },
          password: { type: 'string', description: '登录密码（可选）' },
          privateKey: { type: 'string', description: '私钥内容（可选）' },
          commands: { 
            type: 'array', 
            items: { type: 'string' },
            description: '要执行的命令列表' 
          },
          timeout: { type: 'number', description: '单条命令超时时间（毫秒）' },
        },
        required: ['host', 'username', 'commands'],
      },
      execute: async (params) => {
        const { commands, timeout, ...sshConfig } = params;
        const conn = new SSHConnection(sshConfig);
        
        try {
          await conn.connect();
          const results = await conn.executeCommands(commands, timeout || 30000);
          conn.disconnect();
          
          return {
            success: results.every(r => r.exitCode === 0),
            results: results.map((r, i) => ({
              command: commands[i],
              stdout: r.stdout,
              stderr: r.stderr,
              exitCode: r.exitCode,
              duration: r.duration,
            })),
          };
        } catch (err: any) {
          conn.disconnect();
          throw new Error(`批量执行命令失败: ${err.message}`);
        }
      },
    });

    // 解析输出工具
    this.register({
      name: 'parse_output',
      description: '解析命令输出，提取关键信息',
      parameters: {
        type: 'object',
        properties: {
          raw_output: { type: 'string', description: '原始命令输出' },
          format: { 
            type: 'string', 
            description: '输出格式类型',
            enum: ['table', 'key_value', 'list', 'json', 'custom'],
            default: 'key_value'
          },
          keys: { 
            type: 'array', 
            items: { type: 'string' },
            description: '要提取的键名列表（用于 key_value 或 custom 格式）' 
          },
        },
        required: ['raw_output'],
      },
      execute: async (params) => {
        const { raw_output, format = 'key_value', keys = [] } = params;
        
        if (format === 'json') {
          try {
            return { success: true, data: JSON.parse(raw_output) };
          } catch {
            return { success: false, error: 'Invalid JSON format' };
          }
        }
        
        if (format === 'key_value' && keys.length > 0) {
          const result: Record<string, string> = {};
          for (const key of keys) {
            const regex = new RegExp(`${key}[\\s:]+(.+)`, 'i');
            const match = raw_output.match(regex);
            if (match) {
              result[key] = match[1].trim();
            }
          }
          return { success: true, data: result };
        }
        
        if (format === 'list') {
          const lines = raw_output.split('\n').filter(l => l.trim());
          return { success: true, data: lines };
        }
        
        // table format: 尝试解析表格输出
        const lines = raw_output.split('\n').filter(l => l.trim());
        const tableData = lines.map(line => {
          const cells = line.split(/\s{2,}/).filter(c => c.trim());
          return cells;
        });
        
        return { success: true, data: tableData };
      },
    });

    // 巡检工具
    this.register({
      name: 'network_inspection',
      description: '对网络设备执行标准巡检',
      parameters: {
        type: 'object',
        properties: {
          host: { type: 'string', description: '设备 IP 地址' },
          port: { type: 'number', description: 'SSH 端口，默认 22' },
          username: { type: 'string', description: '登录用户名' },
          password: { type: 'string', description: '登录密码（可选）' },
          privateKey: { type: 'string', description: '私钥内容（可选）' },
          device_type: { 
            type: 'string', 
            description: '设备类型',
            enum: ['switch', 'router', 'firewall', 'generic'],
            default: 'generic'
          },
        },
        required: ['host', 'username'],
      },
      execute: async (params) => {
        const { device_type = 'generic', ...sshConfig } = params;
        
        // 根据设备类型选择巡检命令
        const inspectionCommands: Record<string, string[]> = {
          switch: [
            'display version',
            'display interface brief',
            'display ip interface brief',
            'display cpu-usage',
            'display memory',
            'display logbuffer',
          ],
          router: [
            'display version',
            'display ip interface brief',
            'display bgp summary',
            'display ip routing-table',
            'display cpu-usage',
            'display memory',
          ],
          firewall: [
            'display version',
            'display interface',
            'display firewall session table',
            'display cpu-usage',
            'display memory',
          ],
          generic: [
            'display version',
            'display interface',
            'display cpu-usage',
            'display memory',
          ],
        };
        
        const commands = inspectionCommands[device_type] || inspectionCommands.generic;
        const conn = new SSHConnection(sshConfig);
        
        try {
          await conn.connect();
          const results = await conn.executeCommands(commands);
          conn.disconnect();
          
          return {
            success: true,
            device: sshConfig.host,
            deviceType: device_type,
            timestamp: new Date().toISOString(),
            commands: commands.map((cmd, i) => ({
              command: cmd,
              result: results[i],
            })),
          };
        } catch (err: any) {
          conn.disconnect();
          throw new Error(`巡检失败: ${err.message}`);
        }
      },
    });
  }

  // 注册工具
  register(handler: ToolHandler): void {
    this.tools.set(handler.name, handler);
  }

  // 获取所有工具
  getTools(): ToolHandler[] {
    return Array.from(this.tools.values());
  }

  // 获取工具定义（用于 LLM）
  getToolsSchema(): any[] {
    return this.getTools().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  // 执行工具
  async execute(toolName: string, params: Record<string, any>): Promise<any> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    // 验证必需参数
    const missingParams = tool.parameters.required.filter(
      (required) => params[required] === undefined
    );
    if (missingParams.length > 0) {
      throw new Error(`Missing required parameters: ${missingParams.join(', ')}`);
    }

    // 填充默认值
    const filledParams: Record<string, any> = { ...params };
    for (const [key, spec] of Object.entries(tool.parameters.properties)) {
      if (filledParams[key] === undefined && spec.default !== undefined) {
        filledParams[key] = spec.default;
      }
    }

    try {
      const result = await tool.execute(filledParams);
      return {
        success: true,
        tool: toolName,
        result,
      };
    } catch (err: any) {
      return {
        success: false,
        tool: toolName,
        error: err.message,
      };
    }
  }
}

// ============================================================
// 巡检工具函数 (供 scheduler.ts 调用)
// ============================================================

import { DeviceInspectionResult, InspectionDevice } from './types.js';

// 设备类型对应的巡检命令
const INSPECTION_COMMANDS: Record<string, string[]> = {
  switch: [
    'display version',
    'display device',
    'display interface brief',
    'display ip interface brief',
    'display cpu-usage',
    'display memory',
    'display power',
    'display fan',
    'display logbuffer',
  ],
  router: [
    'display version',
    'display ip interface brief',
    'display bgp summary',
    'display ip routing-table',
    'display cpu-usage',
    'display memory',
    'display logbuffer',
  ],
  firewall: [
    'display version',
    'display device',
    'display interface',
    'display firewall session table',
    'display cpu-usage',
    'display memory',
    'display power',
  ],
  generic: [
    'display version',
    'display interface',
    'display cpu-usage',
    'display memory',
  ],
};

/**
 * 巡检单个设备
 */
export async function inspectDevice(device: InspectionDevice): Promise<DeviceInspectionResult> {
  const deviceType = device.deviceType || 'generic';
  const commands = device.customCommands || INSPECTION_COMMANDS[deviceType] || INSPECTION_COMMANDS.generic;

  const result: DeviceInspectionResult = {
    device: device.host,
    deviceType,
    success: false,
    commands: [],
    timestamp: new Date().toISOString(),
  };

  let conn: SSHConnection | null = null;

  try {
    conn = new SSHConnection({
      host: device.host,
      port: device.port || 22,
      username: device.username,
      password: device.password,
      privateKey: device.privateKey,
    });

    await conn.connect();

    // 依次执行巡检命令
    for (const cmd of commands) {
      try {
        const cmdResult = await conn.executeCommand(cmd, 30000);
        result.commands.push({
          command: cmd,
          stdout: cmdResult.stdout,
          stderr: cmdResult.stderr,
          exitCode: cmdResult.exitCode,
          duration: cmdResult.duration,
        });
      } catch (cmdError: any) {
        result.commands.push({
          command: cmd,
          stdout: '',
          stderr: cmdError.message,
          exitCode: -1,
          duration: 0,
        });
      }
    }

    result.success = result.commands.every(c => c.exitCode === 0);
  } catch (error: any) {
    result.error = error.message;
  } finally {
    if (conn) {
      conn.disconnect();
    }
  }

  return result;
}

// 单例导出
export const toolExecutor = new ToolExecutor();

// ============================================================
// 巡检意图解析工具 (OP47)
// ============================================================

export interface ParsedInspectionIntent {
  intent: 'create_template' | 'create_schedule' | 'run_inspection' | 'query';
  deviceType?: 'switch' | 'router' | 'firewall' | 'generic';
  templateName?: string;
  devices?: Array<{
    host: string;
    port?: number;
    username: string;
    password?: string;
  }>;
  commands?: string[];
  cronExpression?: string;
  cronDescription?: string;
  agentId?: string;
  rawQuery: string;
  confidence: number;
}

/**
 * 解析用户自然语言巡检需求 (OP47)
 */
export async function parseInspectionIntent(query: string): Promise<ParsedInspectionIntent> {
  // 这里可以调用 LLM 进行解析，为了简单起见使用规则匹配
  const lowerQuery = query.toLowerCase();

  // 定时任务关键词
  const scheduleKeywords = ['每天', '每周', '每月', '定时', '自动', 'schedule', 'cron', 'periodic'];
  const isScheduleIntent = scheduleKeywords.some(k => lowerQuery.includes(k));

  // 设备类型关键词
  let deviceType: 'switch' | 'router' | 'firewall' | 'generic' = 'generic';
  if (lowerQuery.includes('交换机') || lowerQuery.includes('switch')) {
    deviceType = 'switch';
  } else if (lowerQuery.includes('路由器') || lowerQuery.includes('router')) {
    deviceType = 'router';
  } else if (lowerQuery.includes('防火墙') || lowerQuery.includes('firewall')) {
    deviceType = 'firewall';
  }

  // 解析 IP 地址
  const ipRegex = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
  const ipMatches = query.match(ipRegex) || [];

  // 解析 cron 表达式
  let cronExpression: string | undefined;
  const cronRegex = /\b(\d+)\s*点|每[天周月]?\s*(\d+)|(\d+)\s*:\s*(\d+)/g;
  const cronMatch = query.match(cronRegex);
  if (cronMatch) {
    if (lowerQuery.includes('每天') || lowerQuery.includes('daily')) {
      cronExpression = '0 9 * * *'; // 每天 9 点
    } else if (lowerQuery.includes('每周') || lowerQuery.includes('weekly')) {
      cronExpression = '0 9 * * 1'; // 每周一 9 点
    } else if (lowerQuery.includes('每月') || lowerQuery.includes('monthly')) {
      cronExpression = '0 9 1 * *'; // 每月 1 号 9 点
    }
  }

  // 解析模板名称
  let templateName: string | undefined;
  const nameMatch = query.match(/(?:模板名为?|叫|名称)[：:\s]*([^\s，,。]+)/i);
  if (nameMatch) {
    templateName = nameMatch[1];
  }

  // 确定意图类型
  let intent: ParsedInspectionIntent['intent'] = 'query';
  let confidence = 0.5;

  if (isScheduleIntent) {
    intent = 'create_schedule';
    confidence = 0.8;
  } else if (ipMatches.length > 0 || lowerQuery.includes('巡检') || lowerQuery.includes('检查')) {
    intent = 'run_inspection';
    confidence = 0.7;
  } else if (templateName || lowerQuery.includes('创建模板')) {
    intent = 'create_template';
    confidence = 0.7;
  }

  // 构建返回结果
  const devices = ipMatches.slice(0, 5).map((host, index) => ({
    host,
    username: 'admin', // 默认用户名
  }));

  return {
    intent,
    deviceType,
    templateName,
    devices: devices.length > 0 ? devices : undefined,
    cronExpression,
    rawQuery: query,
    confidence,
  };
}

// ============================================================
// 创建巡检模板工具 (OP48)
// ============================================================

interface CreateInspectionTemplateParams {
  name: string;
  description?: string;
  deviceType: 'switch' | 'router' | 'firewall' | 'generic';
  commands?: string[];
  devices?: Array<{
    host: string;
    port?: number;
    username: string;
    password?: string;
  }>;
}

// 预设命令模板
const PRESET_COMMANDS: Record<string, string[]> = {
  switch: [
    'display version',
    'display device',
    'display interface brief',
    'display ip interface brief',
    'display cpu-usage',
    'display memory',
    'display power',
    'display fan',
    'display logbuffer',
  ],
  router: [
    'display version',
    'display ip interface brief',
    'display bgp summary',
    'display ip routing-table',
    'display cpu-usage',
    'display memory',
    'display logbuffer',
  ],
  firewall: [
    'display version',
    'display device',
    'display interface',
    'display firewall session table',
    'display cpu-usage',
    'display memory',
    'display power',
  ],
  generic: [
    'display version',
    'display interface',
    'display cpu-usage',
    'display memory',
  ],
};

// 导入 prisma（延迟导入避免循环依赖）
let _prisma: any = null;
async function getPrisma() {
  if (!_prisma) {
    const { prisma } = await import('../lib/prisma.js');
    _prisma = prisma;
  }
  return _prisma;
}

// ============================================================
// 注册聊天集成工具 (OP48-OP49)
// ============================================================

// 导入 scheduler（延迟导入避免循环依赖）
let _scheduler: any = null;
async function getScheduler() {
  if (!_scheduler) {
    try {
      const { scheduleInspection } = await import('./scheduler.js');
      _scheduler = { scheduleInspection };
    } catch {
      _scheduler = {};
    }
  }
  return _scheduler;
}

// 注册创建巡检模板工具
toolExecutor.register({
  name: 'create_inspection_template',
  description: '创建巡检模板，用于后续巡检任务。可用于用户说"创建巡检模板"、"新建模板"等场景。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '模板名称' },
      description: { type: 'string', description: '模板描述（可选）' },
      deviceType: {
        type: 'string',
        description: '设备类型',
        enum: ['switch', 'router', 'firewall', 'generic'],
        default: 'generic',
      },
      commands: {
        type: 'array',
        items: { type: 'string' },
        description: '巡检命令列表（可选，默认使用设备类型的预设命令）',
      },
      devices: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            host: { type: 'string', description: '设备 IP 地址' },
            port: { type: 'number', description: 'SSH 端口（可选，默认 22）' },
            username: { type: 'string', description: '登录用户名' },
            password: { type: 'string', description: '登录密码（可选）' },
          },
          required: ['host', 'username'],
        },
        description: '预设设备列表（可选）',
      },
    },
    required: ['name', 'deviceType'],
  },
  execute: async (params: CreateInspectionTemplateParams) => {
    try {
      const prisma = await getPrisma();

      const commands = params.commands || PRESET_COMMANDS[params.deviceType] || PRESET_COMMANDS.generic;

      const template = await prisma.inspectionTemplate.create({
        data: {
          name: params.name,
          description: params.description || '',
          deviceType: params.deviceType,
          commands: JSON.stringify(commands),
          devices: JSON.stringify(params.devices || []),
        },
      });

      return {
        success: true,
        template: {
          id: template.id,
          name: template.name,
          description: template.description,
          deviceType: template.deviceType,
          commands: commands,
          devices: params.devices || [],
        },
        message: `已创建巡检模板「${params.name}」，包含 ${commands.length} 条巡检命令${params.devices ? `和 ${params.devices.length} 台设备` : ''}。`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `创建模板失败: ${error.message}`,
      };
    }
  },
});

// 注册创建定时任务工具
toolExecutor.register({
  name: 'create_inspection_schedule',
  description: '创建定时巡检任务。可用于用户说"设置定时巡检"、"创建定时任务"等场景。',
  parameters: {
    type: 'object',
    properties: {
      templateId: { type: 'string', description: '巡检模板 ID（可选，如果提供则使用该模板）' },
      agentId: { type: 'string', description: 'Agent ID' },
      cronExpression: {
        type: 'string',
        description: 'Cron 表达式，如 "0 9 * * *"（每天 9 点）、"0 9 * * 1"（每周一 9 点）',
      },
      cronDescription: { type: 'string', description: 'Cron 表达式的中文描述（可选）' },
      templateName: { type: 'string', description: '模板名称（可选，用于查找或创建模板）' },
      deviceType: {
        type: 'string',
        description: '设备类型（当 templateId 为空时使用）',
        enum: ['switch', 'router', 'firewall', 'generic'],
      },
      devices: {
        type: 'array',
        items: { type: 'object', properties: { host: { type: 'string' }, username: { type: 'string' }, password: { type: 'string' } } },
        description: '设备列表（当 templateId 为空时使用）',
      },
      enabled: { type: 'boolean', description: '是否启用，默认 true' },
    },
    required: ['agentId', 'cronExpression'],
  },
  execute: async (params: {
    templateId?: string;
    agentId: string;
    cronExpression: string;
    cronDescription?: string;
    templateName?: string;
    deviceType?: string;
    devices?: Array<{ host: string; username: string; password?: string }>;
    enabled?: boolean;
  }) => {
    try {
      const prisma = await getPrisma();

      // 如果没有提供 templateId，尝试查找或创建模板
      let templateId = params.templateId;

      if (!templateId) {
        // 查找同名模板
        if (params.templateName) {
          const existing = await prisma.inspectionTemplate.findFirst({
            where: { name: params.templateName },
          });
          if (existing) {
            templateId = existing.id;
          }
        }

        // 如果仍未找到，创建临时模板
        if (!templateId) {
          const templateName = params.templateName || `临时模板_${Date.now()}`;
          const deviceType = (params.deviceType as any) || 'generic';
          const commands = PRESET_COMMANDS[deviceType] || PRESET_COMMANDS.generic;

          const newTemplate = await prisma.inspectionTemplate.create({
            data: {
              name: templateName,
              description: '通过聊天自动创建',
              deviceType,
              commands: JSON.stringify(commands),
              devices: JSON.stringify(params.devices || []),
            },
          });
          templateId = newTemplate.id;
        }
      }

      // 创建定时任务
      const schedule = await prisma.inspectionSchedule.create({
        data: {
          templateId,
          agentId: params.agentId,
          cronExpression: params.cronExpression,
          enabled: params.enabled !== false,
        },
      });

      // 启动调度器
      const scheduler = await getScheduler();
      if (scheduler?.scheduleInspection && schedule.enabled) {
        scheduler.scheduleInspection(schedule);
      }

      const description = params.cronDescription || params.cronExpression;

      return {
        success: true,
        schedule: {
          id: schedule.id,
          templateId: schedule.templateId,
          cronExpression: schedule.cronExpression,
          enabled: schedule.enabled,
        },
        message: `已创建定时巡检任务，执行周期：${description}。`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `创建定时任务失败: ${error.message}`,
      };
    }
  },
});

// 注册获取模板列表工具
toolExecutor.register({
  name: 'get_inspection_templates',
  description: '获取所有巡检模板列表，包括模板 ID、名称、描述等信息。',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async () => {
    try {
      const prisma = await getPrisma();
      const templates = await prisma.inspectionTemplate.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { records: true, schedules: true },
          },
        },
      });

      return {
        success: true,
        templates: templates.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          deviceType: t.deviceType,
          commands: JSON.parse(t.commands || '[]'),
          devices: JSON.parse(t.devices || '[]'),
          recordCount: t._count.records,
          scheduleCount: t._count.schedules,
          createdAt: t.createdAt,
        })),
      };
    } catch (error: any) {
      return {
        success: false,
        error: `获取模板列表失败: ${error.message}`,
      };
    }
  },
});
