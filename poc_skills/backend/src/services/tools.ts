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

// 单例导出
export const toolExecutor = new ToolExecutor();
