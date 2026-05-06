import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

const router = Router();

/**
 * 获取仪表盘统计数据
 * GET /api/stats/dashboard
 */
router.get('/dashboard', async (_req, res) => {
  try {
    const [
      agentCount,
      skillCount,
      conversationCount,
      messageCount,
      inspectionCount,
      unreadNotificationCount,
    ] = await Promise.all([
      prisma.agent.count(),
      prisma.skill.count(),
      prisma.conversation.count(),
      prisma.message.count(),
      prisma.inspectionRecord.count(),
      prisma.notification.count({ where: { isRead: false } }),
    ]);

    res.json({
      success: true,
      data: {
        agentCount,
        skillCount,
        conversationCount,
        messageCount,
        inspectionCount,
        unreadNotificationCount,
      },
    });
  } catch (error) {
    console.error('获取统计数据失败:', error);
    res.status(500).json({ success: false, error: '获取统计数据失败' });
  }
});

export default router;
