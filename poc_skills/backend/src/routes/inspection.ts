import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { SSHConnection } from '../services/tools.js';

const router = Router();

// 巡检设备配置
interface InspectionDevice {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  deviceType?: 'switch' | 'router' | 'firewall' | 'generic';
  customCommands?: string[];
}

// 巡检结果
interface DeviceInspectionResult {
  device: string;
  deviceType: string;
  success: boolean;
  error?: string;
  commands: {
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    duration: number;
  }[];
  timestamp: string;
}

// 巡检请求验证
const InspectionSchema = z.object({
  agentId: z.string().min(1),
  devices: z.array(z.object({
    host: z.string().min(1),
    port: z.number().optional(),
    username: z.string().min(1),
    password: z.string().optional(),
    privateKey: z.string().optional(),
    deviceType: z.enum(['switch', 'router', 'firewall', 'generic']).optional(),
    customCommands: z.array(z.string()).optional(),
  })).min(1),
  concurrency: z.number().min(1).max(10).optional(),
});

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

// 巡检单个设备
async function inspectDevice(device: InspectionDevice): Promise<DeviceInspectionResult> {
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

// POST /api/inspection - 执行批量巡检
router.post('/', async (req, res) => {
  try {
    const { agentId, devices, concurrency = 3 } = InspectionSchema.parse(req.body);

    // 验证 Agent 存在
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    if (!agent.enabled) {
      return res.status(400).json({ success: false, error: 'Agent is disabled' });
    }

    // 创建巡检会话
    const inspectionSession = await prisma.conversation.create({
      data: {
        agentId,
        title: `批量巡检 ${new Date().toLocaleString()}`,
      },
    });

    // 分批执行巡检（控制并发）
    const results: DeviceInspectionResult[] = [];
    const totalDevices = devices.length;
    let completedDevices = 0;

    for (let i = 0; i < devices.length; i += concurrency) {
      const batch = devices.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(device => inspectDevice(device))
      );
      results.push(...batchResults);
      completedDevices += batch.length;

      // 保存巡检结果
      await prisma.message.create({
        data: {
          conversationId: inspectionSession.id,
          role: 'assistant',
          content: JSON.stringify({
            type: 'inspection_progress',
            completed: completedDevices,
            total: totalDevices,
            device: batch[0].host,
            success: batchResults[0]?.success,
          }),
        },
      });
    }

    // 保存完整巡检结果
    await prisma.message.create({
      data: {
        conversationId: inspectionSession.id,
        role: 'assistant',
        content: JSON.stringify({
          type: 'inspection_result',
          results,
          summary: {
            total: results.length,
            success: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
          },
        }),
      },
    });

    res.json({
      success: true,
      data: {
        sessionId: inspectionSession.id,
        results,
        summary: {
          total: results.length,
          success: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
        },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Inspection error:', error);
    res.status(500).json({ success: false, error: 'Inspection failed' });
  }
});

// GET /api/inspection/:sessionId - 获取巡检结果
router.get('/:sessionId', async (req, res) => {
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId: req.params.sessionId },
      orderBy: { createdAt: 'asc' },
    });

    const results = messages
      .filter(m => m.role === 'assistant' && m.content.includes('inspection_result'))
      .map(m => {
        try {
          return JSON.parse(m.content);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    res.json({
      success: true,
      data: {
        sessionId: req.params.sessionId,
        results,
      },
    });
  } catch (error) {
    console.error('Get inspection error:', error);
    res.status(500).json({ success: false, error: 'Failed to get inspection results' });
  }
});

// POST /api/inspection/quick - 快速巡检（从配置读取设备列表）
router.post('/quick', async (req, res) => {
  try {
    const { agentId } = req.body as { agentId: string };

    if (!agentId) {
      return res.status(400).json({ success: false, error: 'agentId is required' });
    }

    // 获取系统配置中的巡检设备列表
    const devicesConfig = await prisma.systemConfig.findUnique({
      where: { key: 'inspection_devices' },
    });

    if (!devicesConfig?.value) {
      return res.status(400).json({ 
        success: false, 
        error: '巡检设备列表未配置，请在设置中添加 inspection_devices 配置' 
      });
    }

    let devices: InspectionDevice[];
    try {
      devices = JSON.parse(devicesConfig.value);
    } catch {
      return res.status(400).json({ success: false, error: '巡检设备列表格式错误' });
    }

    if (!Array.isArray(devices) || devices.length === 0) {
      return res.status(400).json({ success: false, error: '巡检设备列表为空' });
    }

    // 执行巡检
    const results = await Promise.all(devices.map(d => inspectDevice(d)));

    res.json({
      success: true,
      data: {
        results,
        summary: {
          total: results.length,
          success: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
        },
      },
    });
  } catch (error) {
    console.error('Quick inspection error:', error);
    res.status(500).json({ success: false, error: 'Quick inspection failed' });
  }
});

export default router;
