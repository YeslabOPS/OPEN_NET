/**
 * 通知路由 (OP27-OP32)
 * 通知列表、标记已读、删除、未读数量等接口
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const router = Router();

// ============================================================
// 通知类型枚举
// ============================================================

type NotificationType = 'inspection' | 'report' | 'baseline' | 'system';

// ============================================================
// GET /api/notifications - 通知列表 (OP28)
// ============================================================

router.get('/', async (req, res) => {
  try {
    const {
      page = '1',
      pageSize = '20',
      type,
      isRead,
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const skip = (pageNum - 1) * pageSizeNum;

    // 构建查询条件
    const where: any = {};
    if (type) where.type = type;
    if (isRead !== undefined) where.isRead = isRead === 'true';

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take: pageSizeNum,
        orderBy: { createdAt: 'desc' },
        include: {
          record: {
            select: {
              id: true,
              templateId: true,
              status: true,
              startTime: true,
              template: {
                select: { id: true, name: true },
              },
            },
          },
        },
      }),
      prisma.notification.count({ where }),
    ]);

    // 格式化返回数据
    const formattedNotifications = notifications.map(n => ({
      id: n.id,
      title: n.title,
      content: n.content,
      type: n.type,
      isRead: n.isRead,
      createdAt: n.createdAt,
      relatedRecord: n.record ? {
        id: n.record.id,
        templateId: n.record.templateId,
        status: n.record.status,
        startTime: n.record.startTime,
        template: n.record.template,
      } : null,
    }));

    res.json({
      success: true,
      data: {
        notifications: formattedNotifications,
        pagination: {
          page: pageNum,
          pageSize: pageSizeNum,
          total,
          totalPages: Math.ceil(total / pageSizeNum),
        },
      },
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ success: false, error: 'Failed to get notifications' });
  }
});

// ============================================================
// GET /api/notifications/unread-count - 未读数量 (OP32)
// ============================================================

router.get('/unread-count', async (_req, res) => {
  try {
    const count = await prisma.notification.count({
      where: { isRead: false },
    });

    res.json({
      success: true,
      data: { count },
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ success: false, error: 'Failed to get unread count' });
  }
});

// ============================================================
// PUT /api/notifications/:id/read - 标记已读 (OP29)
// ============================================================

router.put('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;

    // 检查通知是否存在
    const existing = await prisma.notification.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: '通知不存在' });
    }

    // 更新为已读
    const notification = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    res.json({
      success: true,
      data: {
        id: notification.id,
        isRead: notification.isRead,
      },
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ success: false, error: 'Failed to mark as read' });
  }
});

// ============================================================
// PUT /api/notifications/read-all - 全部标记已读 (OP30)
// ============================================================

router.put('/read-all', async (_req, res) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { isRead: false },
      data: { isRead: true },
    });

    res.json({
      success: true,
      data: {
        updatedCount: result.count,
      },
    });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({ success: false, error: 'Failed to mark all as read' });
  }
});

// ============================================================
// DELETE /api/notifications/:id - 删除通知 (OP31)
// ============================================================

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 检查通知是否存在
    const existing = await prisma.notification.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: '通知不存在' });
    }

    await prisma.notification.delete({
      where: { id },
    });

    res.json({ success: true, message: '通知已删除' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete notification' });
  }
});

// ============================================================
// 辅助函数：创建通知（供其他模块调用）
// ============================================================

export async function createNotification(data: {
  title: string;
  content: string;
  type: NotificationType;
  relatedRecordId?: string;
  userId?: string;
}) {
  return prisma.notification.create({
    data: {
      title: data.title,
      content: data.content,
      type: data.type,
      relatedRecordId: data.relatedRecordId || null,
      userId: data.userId || null,
    },
  });
}

export async function createNotifications(dataList: Array<{
  title: string;
  content: string;
  type: NotificationType;
  relatedRecordId?: string;
  userId?: string;
}>) {
  if (dataList.length === 0) return [];
  
  const createData = dataList.map(d => ({
    title: d.title,
    content: d.content,
    type: d.type,
    relatedRecordId: d.relatedRecordId || null,
    userId: d.userId || null,
  }));
  
  return prisma.notification.createMany({
    data: createData,
  });
}

export default router;
