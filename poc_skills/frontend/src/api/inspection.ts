/**
 * 巡检相关 API (OP38)
 */

import apiClient from './index';

// ============================================================
// 类型定义
// ============================================================

export interface InspectionDevice {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  deviceType?: 'switch' | 'router' | 'firewall' | 'generic';
  customCommands?: string[];
}

export interface InspectionTemplate {
  id: string;
  name: string;
  description?: string;
  deviceType: string;
  commands: string[];
  devices: InspectionDevice[];
  recordCount: number;
  scheduleCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface InspectionRecord {
  id: string;
  status: 'running' | 'success' | 'failed';
  devices: InspectionDevice[];
  devicesCount: number;
  summary: {
    totalDevices: number;
    successDevices: number;
    failedDevices: number;
    totalCommands: number;
    successCommands: number;
    duration: number;
    agentAnalysis?: string;
    baselineGenerated?: boolean;
    baselineVersion?: number;
  };
  startTime: string;
  endTime?: string;
  template?: {
    id: string;
    name: string;
    deviceType: string;
  };
  agent?: {
    id: string;
    name: string;
  };
}

export interface InspectionRecordDetail extends InspectionRecord {
  results: any;
  reportPath?: string;
  reportContent?: string;
  template?: {
    id: string;
    name: string;
    deviceType: string;
    description?: string;
  };
  agent?: {
    id: string;
    name: string;
  };
  recentNotifications: Array<{
    id: string;
    type: string;
    isRead: boolean;
    createdAt: string;
  }>;
}

export interface InspectionSchedule {
  id: string;
  templateId: string;
  agentId: string;
  cronExpression: string;
  cronDescription?: string;
  enabled: boolean;
  lastRunTime?: string;
  lastRunStatus?: string;
  createdAt: string;
  updatedAt: string;
  template?: {
    id: string;
    name: string;
    deviceType: string;
  };
  agent?: {
    id: string;
    name: string;
  };
}

export interface BaselineInfo {
  id: string;
  version: number;
  generatedAt: string;
  isActive?: boolean;
  content?: string;
  filePath?: string;
}

export interface BaselineResponse {
  hasBaseline: boolean;
  template?: {
    id: string;
    name: string;
    deviceType: string;
  };
  baseline?: BaselineInfo;
  message?: string;
}

// ============================================================
// 分页类型
// ============================================================

export interface PaginatedResponse<T> {
  records?: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginatedNotifications {
  notifications: any[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================
// 巡检模板 API
// ============================================================

/**
 * 获取巡检模板列表
 */
export async function getTemplates(): Promise<InspectionTemplate[]> {
  const response = await apiClient.get('/inspection/templates');
  console.log('[API] getTemplates response:', response);
  return response;
}

/**
 * 获取单个巡检模板
 */
export async function getTemplate(id: string): Promise<InspectionTemplate> {
  return apiClient.get(`/inspection/templates/${id}`);
}

/**
 * 创建巡检模板
 */
export async function createTemplate(data: {
  name: string;
  description?: string;
  deviceType: string;
  commands: string[];
  devices: InspectionDevice[];
}): Promise<InspectionTemplate> {
  console.log('[API] createTemplate data:', data);
  const response = await apiClient.post('/inspection/templates', data);
  console.log('[API] createTemplate response:', response);
  return response;
}

/**
 * 更新巡检模板
 */
export async function updateTemplate(
  id: string,
  data: Partial<{
    name: string;
    description?: string;
    deviceType: string;
    commands: string[];
    devices: InspectionDevice[];
  }>
): Promise<InspectionTemplate> {
  console.log('[API] updateTemplate id:', id, 'data:', data);
  const response = await apiClient.put(`/inspection/templates/${id}`, data);
  console.log('[API] updateTemplate response:', response);
  return response;
}

/**
 * 删除巡检模板
 */
export async function deleteTemplate(id: string, force: boolean = false): Promise<void> {
  const url = force ? `/inspection/templates/${id}?force=true` : `/inspection/templates/${id}`;
  try {
    await apiClient.delete(url);
  } catch (error: any) {
    // 如果后端返回了 details 信息，需要抛出错误让前端处理
    if (error.details) {
      const err: any = new Error('无法直接删除：模板关联了定时任务或巡检记录');
      err.details = error.details;
      throw err;
    }
    throw error;
  }
}

// ============================================================
// 巡检执行 API
// ============================================================

/**
 * 执行巡检
 */
export async function runInspection(data: {
  agentId: string;
  templateId?: string;
  devices: InspectionDevice[];
  concurrency?: number;
}): Promise<{
  recordId: string;
  results: any[];
  summary: any;
  baselineGenerated?: boolean;
  baselineAnalyzed?: boolean;
}> {
  return apiClient.post('/inspection', data);
}

/**
 * 获取巡检记录列表
 */
export async function getInspectionRecords(params?: {
  page?: number;
  pageSize?: number;
  status?: string;
  templateId?: string;
}): Promise<PaginatedResponse<InspectionRecord>> {
  return apiClient.get('/inspection/records', { params });
}

/**
 * 获取巡检记录详情
 */
export async function getInspectionRecord(id: string): Promise<InspectionRecordDetail> {
  return apiClient.get(`/inspection/records/${id}`);
}

// ============================================================
// 定时任务 API
// ============================================================

/**
 * 获取定时任务列表
 */
export async function getSchedules(): Promise<InspectionSchedule[]> {
  return apiClient.get('/inspection/schedules');
}

/**
 * 创建定时任务
 */
export async function createSchedule(data: {
  templateId: string;
  agentId: string;
  cronExpression: string;
  enabled?: boolean;
}): Promise<InspectionSchedule> {
  return apiClient.post('/inspection/schedules', data);
}

/**
 * 更新定时任务
 */
export async function updateSchedule(
  id: string,
  data: Partial<{
    templateId: string;
    agentId: string;
    cronExpression: string;
    enabled: boolean;
  }>
): Promise<InspectionSchedule> {
  return apiClient.put(`/inspection/schedules/${id}`, data);
}

/**
 * 删除定时任务
 */
export async function deleteSchedule(id: string): Promise<void> {
  return apiClient.delete(`/inspection/schedules/${id}`);
}

/**
 * 手动触发定时任务
 */
export async function triggerSchedule(id: string): Promise<{
  recordId: string;
  message: string;
}> {
  return apiClient.post(`/inspection/schedules/${id}/run`);
}

// ============================================================
// 基线文档 API
// ============================================================

/**
 * 获取基线文档
 */
export async function getBaseline(templateId: string): Promise<BaselineResponse> {
  return apiClient.get(`/inspection/baselines/${templateId}`);
}

/**
 * 获取基线历史版本
 */
export async function getBaselineHistory(templateId: string): Promise<{
  template: { id: string; name: string };
  versions: Array<{
    id: string;
    version: number;
    generatedAt: string;
    isActive: boolean;
    filePath: string;
  }>;
}> {
  return apiClient.get(`/inspection/baselines/${templateId}/history`);
}

/**
 * 重新生成基线
 */
export async function regenerateBaseline(
  templateId: string,
  agentId?: string
): Promise<{
  version: number;
  filePath: string;
  message: string;
}> {
  return apiClient.post(`/inspection/baselines/${templateId}/regenerate`, { agentId });
}

// ============================================================
// 设备 SSH 测试 API
// ============================================================

/**
 * 测试设备 SSH 连接
 */
export async function testSSHConnection(device: InspectionDevice): Promise<{
  success: boolean;
  message: string;
  latency?: number;
}> {
  return apiClient.post('/inspection/devices/test', device);
}
