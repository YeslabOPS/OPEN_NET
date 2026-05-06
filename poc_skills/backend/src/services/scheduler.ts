/**
 * 定时任务调度服务 (OP15)
 * 基于 node-cron 实现进程内定时任务调度
 */

import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { inspectDevice } from './tools.js';
import { generateReportContent, saveReport } from './reportGenerator.js';
import { DeviceInspectionResult } from './types.js';

// 存储定时任务映射: scheduleId -> ScheduledTask
const scheduledTasks = new Map<string, ScheduledTask>();

// cron 表达式验证
export function isValidCronExpression(expression: string): boolean {
  return cron.validate(expression);
}

// cron 表达式格式化说明
export function getCronDescription(expression: string): string {
  const parts = expression.split(' ');
  if (parts.length < 5) return '无效的 cron 表达式';

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const desc: string[] = [];
  if (minute === '*') desc.push('每分钟');
  else if (minute === '0') desc.push('整点');
  else desc.push(`第 ${minute} 分钟`);

  if (hour !== '*') desc.push(`${hour}点`);
  if (dayOfWeek !== '*') {
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    if (dayOfWeek === '1-5') desc.push('工作日');
    else {
      const day = parseInt(dayOfWeek);
      if (!isNaN(day) && day >= 0 && day <= 6) desc.push(weekDays[day]);
    }
  }

  return desc.join('，');
}

// 通用巡检执行函数（被定时任务调用）
async function executeScheduledInspection(
  scheduleId: string,
  templateId: string,
  agentId: string
): Promise<void> {
  console.log(`[Scheduler] 执行定时巡检: scheduleId=${scheduleId}`);

  try {
    // 获取模板和 Agent
    const [template, agent] = await Promise.all([
      prisma.inspectionTemplate.findUnique({ where: { id: templateId } }),
      prisma.agent.findUnique({ where: { id: agentId } }),
    ]);

    if (!template || !agent) {
      console.error(`[Scheduler] 模板或 Agent 不存在: templateId=${templateId}, agentId=${agentId}`);
      return;
    }

    if (!agent.enabled) {
      console.log(`[Scheduler] Agent 已禁用，跳过巡检: agentId=${agentId}`);
      return;
    }

    const devices = JSON.parse(template.devices || '[]');
    if (devices.length === 0) {
      console.log(`[Scheduler] 模板无设备，跳过巡检: templateId=${templateId}`);
      return;
    }

    // 创建巡检记录
    const startTime = new Date();
    const inspectionRecord = await prisma.inspectionRecord.create({
      data: {
        templateId,
        agentId,
        status: 'running',
        devices: template.devices,
      },
    });

    // 执行巡检
    const results: DeviceInspectionResult[] = [];
    const concurrency = 3;

    for (let i = 0; i < devices.length; i += concurrency) {
      const batch = devices.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(device => inspectDevice(device))
      );
      results.push(...batchResults);
    }

    const endTime = new Date();

    // 生成报告
    const reportContent = generateReportContent(results, {
      templateName: template.name,
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

    // 更新定时任务状态
    await prisma.inspectionSchedule.update({
      where: { id: scheduleId },
      data: {
        lastRunTime: endTime,
        lastRunStatus: 'success',
      },
    });

    console.log(`[Scheduler] 巡检完成: recordId=${inspectionRecord.id}, success=${summary.successDevices}/${summary.totalDevices}`);
  } catch (error) {
    console.error(`[Scheduler] 巡检执行失败:`, error);

    // 更新状态为失败
    await prisma.inspectionSchedule.update({
      where: { id: scheduleId },
      data: {
        lastRunTime: new Date(),
        lastRunStatus: 'failed',
      },
    }).catch(console.error);
  }
}

// 启动定时任务 (OP15, OP20)
export async function startSchedule(schedule: {
  id: string;
  templateId: string;
  agentId: string;
  cronExpression: string;
  enabled: boolean;
}): Promise<void> {
  // 如果已存在，先停止
  if (scheduledTasks.has(schedule.id)) {
    stopSchedule(schedule.id);
  }

  if (!schedule.enabled) {
    console.log(`[Scheduler] 任务已禁用，跳过启动: scheduleId=${schedule.id}`);
    return;
  }

  if (!isValidCronExpression(schedule.cronExpression)) {
    console.error(`[Scheduler] 无效的 cron 表达式: ${schedule.cronExpression}`);
    return;
  }

  const task = cron.schedule(schedule.cronExpression, () => {
    executeScheduledInspection(schedule.id, schedule.templateId, schedule.agentId);
  });

  scheduledTasks.set(schedule.id, task);
  console.log(`[Scheduler] 定时任务已启动: scheduleId=${schedule.id}, cron=${schedule.cronExpression}`);
}

// 停止定时任务
export function stopSchedule(scheduleId: string): void {
  const task = scheduledTasks.get(scheduleId);
  if (task) {
    task.stop();
    scheduledTasks.delete(scheduleId);
    console.log(`[Scheduler] 定时任务已停止: scheduleId=${scheduleId}`);
  }
}

// 重新加载所有定时任务 (OP20)
export async function loadAllSchedules(): Promise<void> {
  console.log('[Scheduler] 加载所有定时任务...');

  const schedules = await prisma.inspectionSchedule.findMany({
    where: { enabled: true },
  });

  for (const schedule of schedules) {
    await startSchedule(schedule);
  }

  console.log(`[Scheduler] 已加载 ${schedules.length} 个定时任务`);
}

// 停止所有定时任务
export function stopAllSchedules(): void {
  for (const [scheduleId] of scheduledTasks) {
    stopSchedule(scheduleId);
  }
  console.log('[Scheduler] 所有定时任务已停止');
}

// 手动触发定时任务 (OP19)
export async function triggerScheduleNow(scheduleId: string): Promise<{
  success: boolean;
  recordId?: string;
  error?: string;
}> {
  const schedule = await prisma.inspectionSchedule.findUnique({
    where: { id: scheduleId },
  });

  if (!schedule) {
    return { success: false, error: '定时任务不存在' };
  }

  if (!schedule.enabled) {
    return { success: false, error: '定时任务已禁用' };
  }

  // 创建巡检记录
  const startTime = new Date();
  let recordId: string;

  try {
    const record = await prisma.inspectionRecord.create({
      data: {
        templateId: schedule.templateId,
        agentId: schedule.agentId,
        status: 'running',
        devices: (await prisma.inspectionTemplate.findUnique({
          where: { id: schedule.templateId },
        }))?.devices || '[]',
      },
    });
    recordId = record.id;

    // 执行巡检
    const template = await prisma.inspectionTemplate.findUnique({
      where: { id: schedule.templateId },
    });
    const agent = await prisma.agent.findUnique({
      where: { id: schedule.agentId },
    });

    if (!template || !agent) {
      throw new Error('模板或 Agent 不存在');
    }

    const devices = JSON.parse(template.devices || '[]');
    const results: DeviceInspectionResult[] = [];

    for (const device of devices) {
      results.push(await inspectDevice(device));
    }

    const endTime = new Date();

    // 生成报告
    const reportContent = generateReportContent(results, {
      templateName: template.name,
      agentName: agent.name,
      startTime,
      endTime,
    });

    const reportPath = await saveReport(recordId, reportContent);

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

    // 更新记录
    await prisma.inspectionRecord.update({
      where: { id: recordId },
      data: {
        status: 'success',
        results: JSON.stringify(results),
        reportPath,
        endTime,
        summary: JSON.stringify(summary),
      },
    });

    // 更新定时任务状态
    await prisma.inspectionSchedule.update({
      where: { id: scheduleId },
      data: {
        lastRunTime: endTime,
        lastRunStatus: 'success',
      },
    });

    return { success: true, recordId };
  } catch (error: any) {
    // 更新状态为失败
    await prisma.inspectionSchedule.update({
      where: { id: scheduleId },
      data: {
        lastRunTime: new Date(),
        lastRunStatus: 'failed',
      },
    }).catch(console.error);

    return { success: false, error: error.message };
  }
}
