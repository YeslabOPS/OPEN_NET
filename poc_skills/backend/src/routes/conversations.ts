import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const router = Router();

// Validation schemas
const CreateConversationSchema = z.object({
  agentId: z.string().min(1),
  title: z.string().optional(),
});

const CreateMessageSchema = z.object({
  conversationId: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1),
  toolCalls: z.array(z.any()).optional(),
  toolCallId: z.string().optional(),
});

// GET /api/conversations - 获取所有对话
router.get('/', async (req, res) => {
  try {
    const { agentId, limit = '50', offset = '0' } = req.query;
    
    const where: any = {};
    if (agentId) where.agentId = agentId;
    
    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        agent: { select: { id: true, name: true } },
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, createdAt: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
    });
    
    const total = await prisma.conversation.count({ where });
    
    res.json({
      success: true,
      data: conversations,
      pagination: { total, limit: parseInt(limit as string), offset: parseInt(offset as string) },
    });
  } catch (error) {
    console.error('Failed to fetch conversations:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch conversations' });
  }
});

// GET /api/conversations/:id - 获取单个对话及消息
router.get('/:id', async (req, res) => {
  try {
    const { limit = '100', offset = '0' } = req.query;
    
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        agent: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          take: parseInt(limit as string),
          skip: parseInt(offset as string),
        },
      },
    });
    
    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }
    
    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error('Failed to fetch conversation:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch conversation' });
  }
});

// POST /api/conversations - 创建对话
router.post('/', async (req, res) => {
  try {
    const data = CreateConversationSchema.parse(req.body);
    
    // 验证 Agent 存在
    const agent = await prisma.agent.findUnique({ where: { id: data.agentId } });
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    
    const conversation = await prisma.conversation.create({
      data: {
        agentId: data.agentId,
        title: data.title || `New conversation ${new Date().toLocaleString()}`,
      },
      include: { agent: true },
    });
    
    res.status(201).json({ success: true, data: conversation });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Failed to create conversation:', error);
    res.status(500).json({ success: false, error: 'Failed to create conversation' });
  }
});

// DELETE /api/conversations/:id - 删除对话
router.delete('/:id', async (req, res) => {
  try {
    await prisma.conversation.delete({
      where: { id: req.params.id },
    });
    
    res.json({ success: true, message: 'Conversation deleted' });
  } catch (error) {
    console.error('Failed to delete conversation:', error);
    res.status(500).json({ success: false, error: 'Failed to delete conversation' });
  }
});

// POST /api/conversations/:id/messages - 添加消息
router.post('/:id/messages', async (req, res) => {
  try {
    const data = CreateMessageSchema.parse(req.body);
    
    // 验证对话存在
    const conversation = await prisma.conversation.findUnique({ where: { id: data.conversationId } });
    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }
    
    const message = await prisma.message.create({
      data: {
        conversationId: data.conversationId,
        role: data.role,
        content: data.content,
        toolCalls: JSON.stringify(data.toolCalls || []),
        toolCallId: data.toolCallId,
      },
    });
    
    // 更新对话的 updatedAt
    await prisma.conversation.update({
      where: { id: data.conversationId },
      data: { updatedAt: new Date() },
    });
    
    res.status(201).json({ success: true, data: message });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Failed to create message:', error);
    res.status(500).json({ success: false, error: 'Failed to create message' });
  }
});

// GET /api/conversations/:id/messages - 获取对话消息
router.get('/:id/messages', async (req, res) => {
  try {
    const { limit = '100', offset = '0' } = req.query;
    
    const messages = await prisma.message.findMany({
      where: { conversationId: req.params.id },
      orderBy: { createdAt: 'asc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
    });
    
    res.json({ success: true, data: messages });
  } catch (error) {
    console.error('Failed to fetch messages:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
});

// DELETE /api/conversations/:conversationId/messages/:messageId - 删除消息
router.delete('/:conversationId/messages/:messageId', async (req, res) => {
  try {
    await prisma.message.delete({
      where: { id: req.params.messageId },
    });
    
    res.json({ success: true, message: 'Message deleted' });
  } catch (error) {
    console.error('Failed to delete message:', error);
    res.status(500).json({ success: false, error: 'Failed to delete message' });
  }
});

export default router;
