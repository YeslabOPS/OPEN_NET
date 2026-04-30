import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const router = Router();

// Validation schema for import
const ImportSkillSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  author: z.string().min(1),
  tags: z.array(z.string()).optional(),
  tools: z.array(z.any()).optional(),
  configurations: z.array(z.any()).optional(),
  icon: z.string().optional(),
});

// POST /api/skills/import/file - 从本地上传文件导入
router.post('/import/file', async (req, res) => {
  try {
    // 解析 multipart form data
    const content = req.body.content || req.body.data;
    
    let skillData;
    if (typeof content === 'string') {
      try {
        skillData = JSON.parse(content);
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid JSON format' });
      }
    } else if (req.file?.buffer) {
      try {
        skillData = JSON.parse(req.file.buffer.toString());
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid JSON in file' });
      }
    } else {
      // 直接接收 JSON body
      skillData = req.body;
    }

    // 验证数据
    const validatedData = ImportSkillSchema.parse(skillData);

    // 检查是否已存在同名 Skill
    const existing = await prisma.skill.findFirst({
      where: { name: validatedData.name },
    });

    if (existing) {
      return res.status(400).json({ 
        success: false, 
        error: `Skill "${validatedData.name}" 已存在，请先删除或使用更新模式` 
      });
    }

    // 创建 Skill
    const skill = await prisma.skill.create({
      data: {
        name: validatedData.name,
        version: validatedData.version,
        description: validatedData.description,
        author: validatedData.author,
        tags: JSON.stringify(validatedData.tags || []),
        tools: JSON.stringify(validatedData.tools || []),
        configurations: JSON.stringify(validatedData.configurations || []),
        icon: validatedData.icon,
        enabled: true,
        builtIn: false,
      },
    });

    res.status(201).json({ success: true, data: skill });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid skill format', details: error.errors });
    }
    console.error('Import skill from file error:', error);
    res.status(500).json({ success: false, error: 'Failed to import skill from file' });
  }
});

// POST /api/skills/import/url - 从 URL 导入
router.post('/import/url', async (req, res) => {
  try {
    const { url } = req.query as { url?: string };

    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    // 验证 URL 格式
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid URL format' });
    }

    // 获取远程内容
    let response: Response;
    try {
      response = await fetch(parsedUrl.toString(), {
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'NetOps-Agent-Skills/1.0',
        },
      });
    } catch (fetchError: any) {
      return res.status(400).json({ 
        success: false, 
        error: `Failed to fetch URL: ${fetchError.message}` 
      });
    }

    if (!response.ok) {
      return res.status(400).json({ 
        success: false, 
        error: `HTTP error: ${response.status} ${response.statusText}` 
      });
    }

    // 解析 JSON
    let skillData: z.infer<typeof ImportSkillSchema>;
    try {
      skillData = await response.json();
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid JSON in remote file' });
    }

    // 验证数据
    const validatedData = ImportSkillSchema.parse(skillData);

    // 检查是否已存在同名 Skill
    const existing = await prisma.skill.findFirst({
      where: { name: validatedData.name },
    });

    if (existing) {
      return res.status(400).json({ 
        success: false, 
        error: `Skill "${validatedData.name}" 已存在` 
      });
    }

    // 创建 Skill
    const skill = await prisma.skill.create({
      data: {
        name: validatedData.name,
        version: validatedData.version,
        description: validatedData.description,
        author: validatedData.author,
        tags: JSON.stringify(validatedData.tags || []),
        tools: JSON.stringify(validatedData.tools || []),
        configurations: JSON.stringify(validatedData.configurations || []),
        icon: validatedData.icon,
        enabled: true,
        builtIn: false,
      },
    });

    res.status(201).json({ success: true, data: skill });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid skill format', details: error.errors });
    }
    console.error('Import skill from URL error:', error);
    res.status(500).json({ success: false, error: 'Failed to import skill from URL' });
  }
});

// GET /api/skills/import/validate - 验证 Skill JSON（不保存）
router.post('/import/validate', async (req, res) => {
  try {
    const { data } = req.body;

    if (!data) {
      return res.status(400).json({ success: false, error: 'No data provided' });
    }

    let skillData;
    try {
      skillData = typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid JSON format' });
    }

    // 验证格式
    const validatedData = ImportSkillSchema.parse(skillData);

    // 检查工具定义
    const toolsValidation = validatedData.tools?.map((tool: any) => ({
      name: tool.name || 'unnamed',
      hasHandler: !!tool.handler,
      hasDescription: !!tool.description,
      hasParameters: !!tool.parameters,
    })) || [];

    res.json({
      success: true,
      data: {
        valid: true,
        name: validatedData.name,
        version: validatedData.version,
        toolsCount: validatedData.tools?.length || 0,
        tools: toolsValidation,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid skill format',
        details: error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      });
    }
    res.status(500).json({ success: false, error: 'Validation failed' });
  }
});

export default router;