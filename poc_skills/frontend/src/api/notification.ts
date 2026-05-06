/**
 * 通知相关 API (OP44)
 */

import apiClient from './index';

// ============================================================
// 类型定义
// ============================================================

export interface Notification {
  id: string;
  title: string;
  content: string;
  type: 'inspection' | 'report' | 'baseline' | 'system';
  isRead: boolean;
  createdAt: string;
  relatedRecord?: {
    id: string;
    templateId: string;
    status: string;
    startTime: string;
    template?: {
      id: string;
      name: string;
    };
  };
}

export interface PaginatedNotifications {
  notifications: Notification[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================
// 通知 API
// ============================================================

/**
 * 获取通知列表
 */
export async function getNotifications(params?: {
  page?: number;
  pageSize?: number;
  type?: string;
  isRead?: boolean;
}): Promise<PaginatedNotifications> {
  return apiClient.get('/notifications', { params });
}

/**
 * 获取未读数量
 */
export async function getUnreadCount(): Promise<number> {
  const data = await apiClient.get<{ count: number }>('/notifications/unread-count');
  return data.count;
}

/**
 * 标记通知已读
 */
export async function markAsRead(id: string): Promise<{
  id: string;
  isRead: boolean;
}> {
  return apiClient.put(`/notifications/${id}/read`);
}

/**
 * 全部标记已读
 */
export async function markAllAsRead(): Promise<{
  updatedCount: number;
}> {
  return apiClient.put('/notifications/read-all');
}

/**
 * 删除通知
 */
export async function deleteNotification(id: string): Promise<void> {
  return apiClient.delete(`/notifications/${id}`);
}
