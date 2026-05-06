/**
 * 共享类型定义
 */

// 巡检设备配置
export interface InspectionDevice {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  deviceType?: 'switch' | 'router' | 'firewall' | 'generic';
  customCommands?: string[];
}

// 单个设备的巡检结果
export interface DeviceInspectionResult {
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

// Agent 分析摘要
export interface InspectionSummary {
  totalDevices: number;
  successDevices: number;
  failedDevices: number;
  totalCommands: number;
  successCommands: number;
  duration: number;
  agentAnalysis?: string;
}
