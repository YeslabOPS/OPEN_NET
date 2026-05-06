import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { inspectDevice, testSSHConnection } from '../services/tools.js';
import { generateReportContent, saveReport, readReport } from '../services/reportGenerator.js';
import {
  startSchedule,
  stopSchedule,
  triggerScheduleNow,
  isValidCronExpression,
  getCronDescription,
} from '../services/scheduler.js';
import {
  hasActiveBaseline,
  getActiveBaseline,
  readBaseline,
  analyzeReport,
  generateBaseline,
  analyzeWithBaseline,
  regenerateBaseline,
  getBaselineHistory,
} from '../services/agentParser.js';
import { DeviceInspectionResult, InspectionDevice } from '../services/types.js';

const router = Router();

// 巡检请求验证
const InspectionSchema = z.object({
  agentId: z.string().min(1),
  templateId: z.string().optional(),  // 可选：关联模板
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

// ============================================================
// 巡检模板管理 (OP07-OP10)
// ============================================================

// 模板验证 schema
const TemplateSchema = z.object({
  name: z.string().min(1, '模板名称不能为空'),
  description: z.string().nullable().optional(), // 允许 null、undefined 或 string
  deviceType: z.enum(['switch', 'router', 'firewall', 'generic']),
  commands: z.array(z.string()).default([]),
  devices: z.array(z.object({
    host: z.string().min(1),
    port: z.number().nullable().optional(), // 允许 number、null 或 undefined
    username: z.string().min(1),
    password: z.string().nullable().optional(),
    privateKey: z.string().nullable().optional(),
    deviceType: z.enum(['switch', 'router', 'firewall', 'generic']).optional(),
  })).default([]),
});

// GET /api/inspection/templates - 模板列表 (OP07)
router.get('/templates', async (_req, res) => {
  try {
    const templates = await prisma.inspectionTemplate.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { records: true, schedules: true },
        },
      },
    });

    res.json({
      success: true,
      data: templates.map(t => ({
        ...t,
        commands: JSON.parse(t.commands),
        devices: JSON.parse(t.devices),
        recordCount: t._count.records,
        scheduleCount: t._count.schedules,
      })),
    });
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({ success: false, error: 'Failed to get templates' });
  }
});

// POST /api/inspection/templates - 创建模板 (OP08)
router.post('/templates', async (req, res) => {
  try {
    const data = TemplateSchema.parse(req.body);

    const template = await prisma.inspectionTemplate.create({
      data: {
        name: data.name,
        description: data.description,
        deviceType: data.deviceType,
        commands: JSON.stringify(data.commands),
        devices: JSON.stringify(data.devices),
      },
    });

    res.status(201).json({
      success: true,
      data: {
        ...template,
        commands: JSON.parse(template.commands),
        devices: JSON.parse(template.devices),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Create template error:', error);
    res.status(500).json({ success: false, error: 'Failed to create template' });
  }
});

// PUT /api/inspection/templates/:id - 更新模板 (OP09)
router.put('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('[PUT /templates/:id] body:', JSON.stringify(req.body, null, 2));
    const data = TemplateSchema.partial().parse(req.body);

    // 检查模板是否存在
    const existing = await prisma.inspectionTemplate.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.deviceType !== undefined) updateData.deviceType = data.deviceType;
    if (data.commands !== undefined) updateData.commands = JSON.stringify(data.commands);
    if (data.devices !== undefined) updateData.devices = JSON.stringify(data.devices);

    const template = await prisma.inspectionTemplate.update({
      where: { id },
      data: updateData,
    });

    res.json({
      success: true,
      data: {
        ...template,
        commands: JSON.parse(template.commands),
        devices: JSON.parse(template.devices),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.log('[PUT /templates/:id] Zod error:', JSON.stringify(error.errors, null, 2));
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Update template error:', error);
    res.status(500).json({ success: false, error: 'Failed to update template' });
  }
});

// DELETE /api/inspection/templates/:id - 删除模板 (OP10)
router.delete('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { force } = req.query;

    // 检查模板是否存在
    const existing = await prisma.inspectionTemplate.findUnique({
      where: { id },
      include: {
        records: { select: { id: true } },
        _count: { select: { schedules: true, records: true } },
      },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    // 检查是否有关联的定时任务或巡检记录
    if (existing._count.schedules > 0 || existing._count.records > 0) {
      if (force === 'true') {
        // 强制删除：先删除关联的定时任务和巡检记录
        const recordIds = existing.records.map(r => r.id);
        await prisma.$transaction([
          // 删除关联的通知
          prisma.notification.deleteMany({
            where: {
              relatedRecordId: { in: recordIds },
            },
          }),
          // 删除关联的巡检记录
          prisma.inspectionRecord.deleteMany({
            where: { templateId: id },
          }),
          // 删除关联的定时任务
          prisma.inspectionSchedule.deleteMany({
            where: { templateId: id },
          }),
          // 删除模板
          prisma.inspectionTemplate.delete({
            where: { id },
          }),
        ]);

        return res.json({ success: true, message: '模板及关联记录已删除' });
      } else {
        return res.status(400).json({
          success: false,
          error: '无法删除：模板关联了定时任务或巡检记录',
          details: {
            schedules: existing._count.schedules,
            records: existing._count.records,
          },
        });
      }
    }

    await prisma.inspectionTemplate.delete({ where: { id } });

    res.json({ success: true, message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete template' });
  }
});

// POST /api/inspection/devices/test - 测试设备 SSH 连接
router.post('/devices/test', async (req, res) => {
  try {
    const { host, port, username, password, privateKey } = req.body;

    if (!host || !username) {
      return res.status(400).json({
        success: false,
        error: '缺少必填字段：host 和 username',
      });
    }

    const result = await testSSHConnection({
      host,
      port: port || 22,
      username,
      password,
      privateKey,
    });

    res.json({
      success: result.success,
      data: result,
    });
  } catch (error: any) {
    console.error('Test SSH error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'SSH 连接测试失败',
    });
  }
});

// GET /api/inspection/templates/:id - 获取单个模板 (辅助接口)
router.get('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const template = await prisma.inspectionTemplate.findUnique({
      where: { id },
      include: {
        _count: {
          select: { records: true, schedules: true },
        },
      },
    });

    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    res.json({
      success: true,
      data: {
        ...template,
        commands: JSON.parse(template.commands),
        devices: JSON.parse(template.devices),
        recordCount: template._count.records,
        scheduleCount: template._count.schedules,
      },
    });
  } catch (error) {
    console.error('Get template error:', error);
    res.status(500).json({ success: false, error: 'Failed to get template' });
  }
});

// ============================================================
// 巡检执行与记录 (OP11-OP13)
// ============================================================

// POST /api/inspection - 执行批量巡检 (OP11 - 重构：结果持久化)
router.post('/', async (req, res) => {
  const startTime = new Date();

  try {
    const { agentId, templateId, devices, concurrency = 3 } = InspectionSchema.parse(req.body);

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

    // 验证模板（如果提供）
    if (templateId) {
      const template = await prisma.inspectionTemplate.findUnique({
        where: { id: templateId },
      });
      if (!template) {
        return res.status(404).json({ success: false, error: 'Template not found' });
      }
    }

    // 创建巡检记录 (status = running)
    const inspectionRecord = await prisma.inspectionRecord.create({
      data: {
        templateId: templateId || null,
        agentId,
        status: 'running',
        devices: JSON.stringify(devices),
        results: '{}',
      },
    });

    // 执行巡检
    const results: DeviceInspectionResult[] = [];

    for (let i = 0; i < devices.length; i += concurrency) {
      const batch = devices.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(device => inspectDevice(device))
      );
      results.push(...batchResults);
    }

    const endTime = new Date();

    // 生成报告
    const template = templateId
      ? await prisma.inspectionTemplate.findUnique({ where: { id: templateId } })
      : null;

    const reportContent = generateReportContent(results, {
      templateName: template?.name,
      agentName: agent.name,
      startTime,
      endTime,
    });

    const reportPath = await saveReport(inspectionRecord.id, reportContent);

    // 计算摘要
    const summary = {
      totalDevices: results.length,
      successDevices: results.filter(r => r.success).length,
      failedDevices: results.filter(r => !r.success).length,
      totalCommands: results.reduce((sum, r) => sum + r.commands.length, 0),
      successCommands: results.reduce(
        (sum, r) => sum + r.commands.filter(c => c.exitCode === 0).length,
        0
      ),
      duration: endTime.getTime() - startTime.getTime(),
    };

    // Agent 分析 + 基线处理 (OP23, OP26)
    let agentAnalysis = '';
    let baselineGenerated = false;
    let baselineAnalyzed = false;

    try {
      if (templateId) {
        // 检查是否有活跃基线
        const hasBaseline = await hasActiveBaseline(templateId);

        if (hasBaseline) {
          // OP26: 非首次巡检 - 读取基线并对比分析
          const baseline = await getActiveBaseline(templateId);
          if (baseline) {
            const baselineContent = await readBaseline(baseline.filePath);
            const { analysis, deviations } = await analyzeWithBaseline(
              reportContent,
              baselineContent,
              agentId,
              {
                name: template?.name,
                deviceType: template?.deviceType,
              }
            );
            agentAnalysis = analysis;
            summary.agentAnalysis = analysis;
            summary.deviations = deviations;
            baselineAnalyzed = true;
          }
        } else {
          // OP23: 首次巡检 - 生成基线文档
          const { filePath, version } = await generateBaseline(
            reportContent,
            agentId,
            templateId
          );
          summary.baselineGenerated = true;
          summary.baselineVersion = version;
          summary.baselinePath = filePath;
          baselineGenerated = true;
        }
      } else {
        // 无模板关联时，仅进行简单分析
        const { analysis } = await analyzeReport(
          reportContent,
          agentId
        );
        agentAnalysis = analysis;
        summary.agentAnalysis = analysis;
      }
    } catch (error) {
      console.error('Agent analysis error:', error);
      // Agent 分析失败不影响巡检流程，记录日志即可
      summary.agentAnalysisError = error instanceof Error ? error.message : 'Unknown error';
    }

    // 创建通知
    try {
      const notificationTitle = baselineAnalyzed
        ? `巡检报告偏差分析完成`
        : baselineGenerated
          ? `首次巡检完成，基线已生成`
          : `巡检报告分析完成`;

      const notificationContent = agentAnalysis
        ? agentAnalysis.substring(0, 500) + (agentAnalysis.length > 500 ? '...' : '')
        : baselineGenerated
          ? `模板「${template?.name}」已完成首次巡检，系统已自动生成配置基线文档。`
          : `模板「${template?.name}」巡检完成，共巡检 ${summary.totalDevices} 台设备，成功 ${summary.successDevices} 台。`;

      await prisma.notification.create({
        data: {
          title: notificationTitle,
          content: notificationContent,
          type: baselineGenerated ? 'baseline' : 'report',
          relatedRecordId: inspectionRecord.id,
        },
      });
    } catch (error) {
      console.error('Create notification error:', error);
    }

    // 更新巡检记录
    await prisma.inspectionRecord.update({
      where: { id: inspectionRecord.id },
      data: {
        status: 'success',
        results: JSON.stringify(results),
        reportPath,
        endTime,
        summary: JSON.stringify(summary),
      },
    });

    res.json({
      success: true,
      data: {
        recordId: inspectionRecord.id,
        results,
        summary,
        baselineGenerated,
        baselineAnalyzed,
      },
    });
  } catch (error) {
    // 更新记录状态为失败
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Inspection error:', error);
    res.status(500).json({ success: false, error: 'Inspection failed' });
  }
});

// GET /api/inspection/records - 巡检记录列表 (OP12)
router.get('/records', async (req, res) => {
  try {
    const {
      page = '1',
      pageSize = '20',
      status,
      templateId,
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const skip = (pageNum - 1) * pageSizeNum;

    // 构建查询条件
    const where: any = {};
    if (status) where.status = status;
    if (templateId) where.templateId = templateId;

    const [records, total] = await Promise.all([
      prisma.inspectionRecord.findMany({
        where,
        skip,
        take: pageSizeNum,
        orderBy: { startTime: 'desc' },
        include: {
          template: {
            select: { id: true, name: true, deviceType: true },
          },
          agent: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.inspectionRecord.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        records: records.map(r => ({
          id: r.id,
          status: r.status,
          devices: JSON.parse(r.devices),
          devicesCount: JSON.parse(r.devices).length,
          summary: r.summary ? JSON.parse(r.summary) : null,
          startTime: r.startTime,
          endTime: r.endTime,
          template: r.template,
          agent: r.agent,
        })),
        pagination: {
          page: pageNum,
          pageSize: pageSizeNum,
          total,
          totalPages: Math.ceil(total / pageSizeNum),
        },
      },
    });
  } catch (error) {
    console.error('Get records error:', error);
    res.status(500).json({ success: false, error: 'Failed to get records' });
  }
});

// GET /api/inspection/records/:id - 巡检记录详情 (OP13)
router.get('/records/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const record = await prisma.inspectionRecord.findUnique({
      where: { id },
      include: {
        template: {
          select: { id: true, name: true, deviceType: true, description: true },
        },
        agent: {
          select: { id: true, name: true },
        },
        notifications: {
          select: { id: true, type: true, isRead: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    // 读取报告内容
    let reportContent: string | null = null;
    if (record.reportPath) {
      try {
        reportContent = await readReport(record.reportPath);
      } catch {
        reportContent = null;
      }
    }

    res.json({
      success: true,
      data: {
        id: record.id,
        status: record.status,
        devices: JSON.parse(record.devices),
        results: JSON.parse(record.results || '{}'),
        summary: record.summary ? JSON.parse(record.summary) : null,
        reportPath: record.reportPath,
        reportContent,
        startTime: record.startTime,
        endTime: record.endTime,
        template: record.template,
        agent: record.agent,
        recentNotifications: record.notifications,
      },
    });
  } catch (error) {
    console.error('Get record detail error:', error);
    res.status(500).json({ success: false, error: 'Failed to get record detail' });
  }
});

// GET /api/inspection/:recordId - 获取巡检结果（兼容旧接口）
router.get('/:recordId', async (req, res) => {
  try {
    const { recordId } = req.params;

    const record = await prisma.inspectionRecord.findUnique({
      where: { id: recordId },
      include: {
        template: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
      },
    });

    if (!record) {
      // 兼容旧接口：通过 conversationId 查询
      return res.status(404).json({
        success: false,
        error: 'Record not found. Please use /api/inspection/records/:id',
      });
    }

    res.json({
      success: true,
      data: {
        recordId: record.id,
        results: JSON.parse(record.results || '[]'),
        summary: record.summary ? JSON.parse(record.summary) : null,
        status: record.status,
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

// ============================================================
// 定时任务调度 (OP16-OP19)
// ============================================================

// 定时任务验证 schema
const ScheduleSchema = z.object({
  templateId: z.string().min(1, '请选择巡检模板'),
  agentId: z.string().min(1, '请选择 Agent'),
  cronExpression: z.string().min(1, '请输入 cron 表达式'),
  enabled: z.boolean().default(true),
});

// GET /api/inspection/schedules - 定时任务列表 (辅助接口)
router.get('/schedules', async (_req, res) => {
  try {
    const schedules = await prisma.inspectionSchedule.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        template: {
          select: { id: true, name: true, deviceType: true },
        },
        agent: {
          select: { id: true, name: true },
        },
      },
    });

    res.json({
      success: true,
      data: schedules.map(s => ({
        ...s,
        cronDescription: getCronDescription(s.cronExpression),
      })),
    });
  } catch (error) {
    console.error('Get schedules error:', error);
    res.status(500).json({ success: false, error: 'Failed to get schedules' });
  }
});

// POST /api/inspection/schedules - 创建定时任务 (OP16)
router.post('/schedules', async (req, res) => {
  try {
    const data = ScheduleSchema.parse(req.body);

    // 验证 cron 表达式
    if (!isValidCronExpression(data.cronExpression)) {
      return res.status(400).json({
        success: false,
        error: '无效的 cron 表达式',
      });
    }

    // 验证模板存在
    const template = await prisma.inspectionTemplate.findUnique({
      where: { id: data.templateId },
    });
    if (!template) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }

    // 验证 Agent 存在
    const agent = await prisma.agent.findUnique({
      where: { id: data.agentId },
    });
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent 不存在' });
    }

    // 检查模板是否有设备
    const devices = JSON.parse(template.devices || '[]');
    if (devices.length === 0) {
      return res.status(400).json({
        success: false,
        error: '模板没有配置设备，无法创建定时任务',
      });
    }

    // 创建定时任务
    const schedule = await prisma.inspectionSchedule.create({
      data: {
        templateId: data.templateId,
        agentId: data.agentId,
        cronExpression: data.cronExpression,
        enabled: data.enabled,
      },
      include: {
        template: { select: { id: true, name: true, deviceType: true } },
        agent: { select: { id: true, name: true } },
      },
    });

    // 如果启用，启动调度器
    if (schedule.enabled) {
      await startSchedule(schedule);
    }

    res.status(201).json({
      success: true,
      data: {
        ...schedule,
        cronDescription: getCronDescription(schedule.cronExpression),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Create schedule error:', error);
    res.status(500).json({ success: false, error: 'Failed to create schedule' });
  }
});

// PUT /api/inspection/schedules/:id - 更新定时任务 (OP17)
router.put('/schedules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = ScheduleSchema.partial().parse(req.body);

    // 检查是否存在
    const existing = await prisma.inspectionSchedule.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: '定时任务不存在' });
    }

    // 验证 cron 表达式（如果更新）
    if (data.cronExpression && !isValidCronExpression(data.cronExpression)) {
      return res.status(400).json({
        success: false,
        error: '无效的 cron 表达式',
      });
    }

    // 更新
    const updateData: any = {};
    if (data.templateId !== undefined) updateData.templateId = data.templateId;
    if (data.agentId !== undefined) updateData.agentId = data.agentId;
    if (data.cronExpression !== undefined) updateData.cronExpression = data.cronExpression;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;

    const schedule = await prisma.inspectionSchedule.update({
      where: { id },
      data: updateData,
      include: {
        template: { select: { id: true, name: true, deviceType: true } },
        agent: { select: { id: true, name: true } },
      },
    });

    // 更新调度器
    stopSchedule(id);
    if (schedule.enabled) {
      await startSchedule(schedule);
    }

    res.json({
      success: true,
      data: {
        ...schedule,
        cronDescription: getCronDescription(schedule.cronExpression),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Update schedule error:', error);
    res.status(500).json({ success: false, error: 'Failed to update schedule' });
  }
});

// DELETE /api/inspection/schedules/:id - 删除定时任务 (OP18)
router.delete('/schedules/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.inspectionSchedule.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: '定时任务不存在' });
    }

    // 停止调度器
    stopSchedule(id);

    // 删除
    await prisma.inspectionSchedule.delete({ where: { id } });

    res.json({ success: true, message: '定时任务已删除' });
  } catch (error) {
    console.error('Delete schedule error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete schedule' });
  }
});

// POST /api/inspection/schedules/:id/run - 手动触发定时任务 (OP19)
router.post('/schedules/:id/run', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await triggerScheduleNow(id);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      data: {
        recordId: result.recordId,
        message: '巡检已开始执行',
      },
    });
  } catch (error) {
    console.error('Trigger schedule error:', error);
    res.status(500).json({ success: false, error: 'Failed to trigger schedule' });
  }
});

// ============================================================
// 基线文档管理 (OP24, OP25)
// ============================================================

// GET /api/inspection/baselines/:templateId - 获取当前生效的基线文档内容 (OP24)
router.get('/baselines/:templateId', async (req, res) => {
  try {
    const { templateId } = req.params;

    // 检查模板是否存在
    const template = await prisma.inspectionTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, name: true, deviceType: true },
    });

    if (!template) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }

    // 获取活跃基线
    const baseline = await getActiveBaseline(templateId);

    if (!baseline) {
      return res.json({
        success: true,
        data: {
          hasBaseline: false,
          template,
          message: '该模板暂无基线文档',
        },
      });
    }

    // 读取基线内容
    const content = await readBaseline(baseline.filePath);

    res.json({
      success: true,
      data: {
        hasBaseline: true,
        template,
        baseline: {
          id: baseline.id,
          version: baseline.version,
          generatedAt: baseline.generatedAt,
          content,
        },
      },
    });
  } catch (error) {
    console.error('Get baseline error:', error);
    res.status(500).json({ success: false, error: 'Failed to get baseline' });
  }
});

// GET /api/inspection/baselines/:templateId/history - 获取基线历史版本
router.get('/baselines/:templateId/history', async (req, res) => {
  try {
    const { templateId } = req.params;

    // 检查模板是否存在
    const template = await prisma.inspectionTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, name: true },
    });

    if (!template) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }

    const history = await getBaselineHistory(templateId);

    res.json({
      success: true,
      data: {
        template,
        versions: history.map(h => ({
          id: h.id,
          version: h.version,
          generatedAt: h.generatedAt,
          isActive: h.isActive,
          filePath: h.filePath,
        })),
      },
    });
  } catch (error) {
    console.error('Get baseline history error:', error);
    res.status(500).json({ success: false, error: 'Failed to get baseline history' });
  }
});

// POST /api/inspection/baselines/:templateId/regenerate - 重新生成基线 (OP25)
router.post('/baselines/:templateId/regenerate', async (req, res) => {
  try {
    const { templateId } = req.params;
    const { agentId } = req.body as { agentId?: string };

    // 检查模板是否存在
    const template = await prisma.inspectionTemplate.findUnique({
      where: { id: templateId },
      include: {
        records: {
          orderBy: { startTime: 'desc' },
          take: 1,
          where: { status: 'success', reportPath: { not: null } },
        },
      },
    });

    if (!template) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }

    // 获取最近一次成功巡检的报告
    const latestRecord = template.records[0];

    if (!latestRecord?.reportPath) {
      return res.status(400).json({
        success: false,
        error: '没有可用的巡检报告，请先执行一次巡检',
      });
    }

    // 读取报告内容
    const reportContent = await readReport(latestRecord.reportPath);

    // 如果没有提供 agentId，使用记录中的 agentId
    const targetAgentId = agentId || latestRecord.agentId;

    // 重新生成基线
    const { filePath, version } = await regenerateBaseline(
      templateId,
      reportContent,
      targetAgentId
    );

    // 创建通知
    await prisma.notification.create({
      data: {
        title: '基线文档已重新生成',
        content: `模板「${template.name}」的基线文档已更新为 v${version}。`,
        type: 'baseline',
        relatedRecordId: latestRecord.id,
      },
    });

    res.json({
      success: true,
      data: {
        version,
        filePath,
        message: `基线文档已重新生成，版本更新为 v${version}`,
      },
    });
  } catch (error) {
    console.error('Regenerate baseline error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to regenerate baseline',
    });
  }
});

// GET /api/inspection/baselines/:templateId/content/:version - 获取指定版本的基线内容
router.get('/baselines/:templateId/content/:version', async (req, res) => {
  try {
    const { templateId, version } = req.params;
    const versionNum = parseInt(version, 10);

    if (isNaN(versionNum)) {
      return res.status(400).json({ success: false, error: '无效的版本号' });
    }

    const baseline = await prisma.baselineDocument.findFirst({
      where: { templateId, version: versionNum },
    });

    if (!baseline) {
      return res.status(404).json({ success: false, error: '该版本基线不存在' });
    }

    const content = await readBaseline(baseline.filePath);

    res.json({
      success: true,
      data: {
        baseline: {
          id: baseline.id,
          version: baseline.version,
          generatedAt: baseline.generatedAt,
          isActive: baseline.isActive,
          content,
        },
      },
    });
  } catch (error) {
    console.error('Get baseline version error:', error);
    res.status(500).json({ success: false, error: 'Failed to get baseline version' });
  }
});

// ============================================================
// 聊天确认流程接口 (OP50)
// ============================================================

// 确认请求验证
const ChatConfirmSchema = z.object({
  type: z.enum(['create_template', 'create_schedule', 'run_inspection']),
  data: z.record(z.any()),
  conversationId: z.string(),
});

// POST /api/inspection/chat-confirm - 创建待确认请求
router.post('/chat-confirm', async (req, res) => {
  try {
    const { type, data, conversationId } = ChatConfirmSchema.parse(req.body);

    // 创建确认请求记录（可以是临时存储，这里简化处理）
    const confirmRequest = {
      id: `confirm_${Date.now()}`,
      type,
      data,
      conversationId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    // 返回确认请求信息
    res.json({
      success: true,
      data: {
        confirmId: confirmRequest.id,
        type,
        summary: generateConfirmSummary(type, data),
        message: `请确认是否${getConfirmActionText(type)}？`,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Create confirm request error:', error);
    res.status(500).json({ success: false, error: 'Failed to create confirm request' });
  }
});

// POST /api/inspection/chat-confirm/:confirmId - 执行确认操作
router.post('/chat-confirm/:confirmId/execute', async (req, res) => {
  try {
    const { confirmId } = req.params;
    const { action, conversationId } = req.body as { action: 'confirm' | 'cancel'; conversationId?: string };

    if (!['confirm', 'cancel'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    // 从请求中解析确认信息（实际项目中应该从数据库读取）
    // 这里简化处理，从请求 body 中获取
    const confirmData = req.body.data;
    const type = req.body.type;

    let result: any;

    if (action === 'confirm') {
      switch (type) {
        case 'create_template':
          result = await prisma.inspectionTemplate.create({
            data: {
              name: confirmData.name,
              description: confirmData.description || '',
              deviceType: confirmData.deviceType,
              commands: JSON.stringify(confirmData.commands || []),
              devices: JSON.stringify(confirmData.devices || []),
            },
          });

          // 发送通知 (OP51)
          await prisma.notification.create({
            data: {
              title: '模板创建成功',
              content: `已通过聊天创建巡检模板「${confirmData.name}」`,
              type: 'system',
            },
          });
          break;

        case 'create_schedule':
          result = await prisma.inspectionSchedule.create({
            data: {
              templateId: confirmData.templateId,
              agentId: confirmData.agentId,
              cronExpression: confirmData.cronExpression,
              enabled: confirmData.enabled !== false,
            },
          });

          // 启动调度器
          try {
            const { scheduleInspection } = await import('../services/scheduler.js');
            if (result.enabled) {
              scheduleInspection(result);
            }
          } catch (e) {
            console.error('Failed to start schedule:', e);
          }

          // 发送通知 (OP51)
          await prisma.notification.create({
            data: {
              title: '定时任务创建成功',
              content: `已通过聊天创建定时巡检任务，周期：${confirmData.cronExpression}`,
              type: 'system',
            },
          });
          break;

        case 'run_inspection':
          // 执行巡检
          const record = await prisma.inspectionRecord.create({
            data: {
              agentId: confirmData.agentId,
              templateId: confirmData.templateId || null,
              status: 'running',
              devices: JSON.stringify(confirmData.devices || []),
            },
          });

          // 异步执行巡检
          executeInspectionAsync(record.id, confirmData.agentId, confirmData.devices || []);

          result = { recordId: record.id, status: 'started' };

          // 发送通知 (OP51)
          await prisma.notification.create({
            data: {
              title: '巡检任务已启动',
              content: `已通过聊天启动即时巡检，设备数：${(confirmData.devices || []).length} 台`,
              type: 'inspection',
              relatedRecordId: record.id,
            },
          });
          break;
      }

      res.json({
        success: true,
        data: {
          action,
          result,
          message: `${getConfirmSuccessText(type)}成功！`,
        },
      });
    } else {
      res.json({
        success: true,
        data: {
          action,
          message: '已取消操作',
        },
      });
    }
  } catch (error) {
    console.error('Execute confirm error:', error);
    res.status(500).json({ success: false, error: 'Failed to execute confirm' });
  }
});

// 辅助函数：生成确认摘要
function generateConfirmSummary(type: string, data: any): string {
  switch (type) {
    case 'create_template':
      return `模板名称：${data.name || '未命名'}
设备类型：${data.deviceType || 'generic'}
命令数量：${(data.commands || []).length}
设备数量：${(data.devices || []).length}`;
    case 'create_schedule':
      return `模板 ID：${data.templateId || '新建模板'}
Agent ID：${data.agentId || '未选择'}
执行周期：${data.cronExpression || '未设置'}`;
    case 'run_inspection':
      return `Agent ID：${data.agentId || '未选择'}
设备数量：${(data.devices || []).length}
设备列表：${(data.devices || []).map((d: any) => d.host).join(', ')}`;
    default:
      return JSON.stringify(data);
  }
}

// 辅助函数：获取确认动作文本
function getConfirmActionText(type: string): string {
  switch (type) {
    case 'create_template': return '创建巡检模板';
    case 'create_schedule': return '创建定时任务';
    case 'run_inspection': return '执行巡检';
    default: return '执行操作';
  }
}

// 辅助函数：获取成功文本
function getConfirmSuccessText(type: string): string {
  switch (type) {
    case 'create_template': return '创建模板';
    case 'create_schedule': return '创建定时任务';
    case 'run_inspection': return '启动巡检';
    default: return '执行操作';
  }
}

// 异步执行巡检
async function executeInspectionAsync(recordId: string, agentId: string, devices: any[]) {
  try {
    const concurrency = 3;
    const results: any[] = [];

    // 分批执行
    for (let i = 0; i < devices.length; i += concurrency) {
      const batch = devices.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(device => inspectDevice(device))
      );
      results.push(...batchResults);
    }

    // 更新记录
    await prisma.inspectionRecord.update({
      where: { id: recordId },
      data: {
        status: results.every(r => r.success) ? 'success' : (results.some(r => r.success) ? 'partial' : 'failed'),
        results: JSON.stringify(results),
        endTime: new Date(),
      },
    });
  } catch (error) {
    console.error('Async inspection error:', error);
    await prisma.inspectionRecord.update({
      where: { id: recordId },
      data: {
        status: 'failed',
        endTime: new Date(),
      },
    });
  }
}

export default router;
