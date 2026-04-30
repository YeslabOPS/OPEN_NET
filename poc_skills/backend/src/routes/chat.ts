import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { deepseekService, Message } from '../services/deepseek.js';
import { toolExecutor } from '../services/tools.js';

const router = Router();

const SendMessageSchema = z.object({
  agentId: z.string().min(1),
  content: z.string().min(1),
  conversationId: z.string().optional(),
});

// 工具调用消息
interface ToolCallMessage {
  id: string;
  role: 'tool';
  toolCallId: string;
  toolName: string;
  content: string;
  timestamp: Date;
}

// 解析 LLM 返回的工具调用
function parseToolCalls(content: string): Array<{ name: string; arguments: Record<string, any> }> {
  const toolCalls: Array<{ name: string; arguments: Record<string, any> }> = [];
  
  try {
    // 尝试解析 JSON 格式的工具调用
    // 支持多种格式:
    // 1. {"tool": "xxx", "params": {...}}
    // 2. {"name": "xxx", "arguments": {...}}
    // 3. <tool_call>{"name": "xxx", "params": {...}}</tool_call>
    
    // 提取 JSON 代码块
    const jsonMatches = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/g);
    if (jsonMatches) {
      for (const match of jsonMatches) {
        const jsonStr = match.replace(/```(?:json)?\s*/, '').replace(/\s*```/, '');
        try {
          const parsed = JSON.parse(jsonStr);
          
          // 格式1: {"tool": "xxx", "params": {...}}
          if (parsed.tool && parsed.params) {
            toolCalls.push({ name: parsed.tool, arguments: parsed.params });
          }
          
          // 格式2: {"name": "xxx", "arguments": {...}}
          if (parsed.name && parsed.arguments) {
            toolCalls.push({ name: parsed.name, arguments: parsed.arguments });
          }
        } catch {
          // JSON 解析失败，尝试其他方式
        }
      }
    }
    
    // 尝试提取 XML 格式的工具调用
    const xmlMatches = content.match(/<tool_call>([\s\S]*?)<\/tool_call>/g);
    if (xmlMatches) {
      for (const match of xmlMatches) {
        const xmlContent = match.replace(/<tool_call>/, '').replace(/<\/tool_call>/, '');
        try {
          const parsed = JSON.parse(xmlContent);
          if (parsed.name) {
            toolCalls.push({ 
              name: parsed.name, 
              arguments: parsed.params || parsed.arguments || {} 
            });
          }
        } catch {
          // 解析失败
        }
      }
    }
    
    // 尝试提取 fence 格式
    const fenceMatches = content.match(/```tool_call\s*([\s\S]*?)\s*```/g);
    if (fenceMatches) {
      for (const match of fenceMatches) {
        const jsonStr = match.replace(/```tool_call\s*/, '').replace(/\s*```/, '');
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.name) {
            toolCalls.push({ 
              name: parsed.name, 
              arguments: parsed.params || parsed.arguments || {} 
            });
          }
        } catch {
          // 解析失败
        }
      }
    }
    
  } catch (error) {
    console.error('Failed to parse tool calls:', error);
  }
  
  return toolCalls;
}

// POST /api/chat - 发送消息
router.post('/', async (req, res) => {
  try {
    const { agentId, content, conversationId } = SendMessageSchema.parse(req.body);

    // 获取 Agent
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        skills: {
          include: { skill: true },
        },
      },
    });

    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    if (!agent.enabled) {
      return res.status(400).json({ success: false, error: 'Agent is disabled' });
    }

    // 获取或创建对话
    let conversation;
    if (conversationId) {
      conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });
    }
    
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          agentId,
          title: `Chat ${new Date().toLocaleString()}`,
        },
      });
    }

    // 保存用户消息
    const userMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content,
      },
    });

    // 构建消息历史
    const historyMessages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
    });

    // 获取工具定义
    const availableTools = toolExecutor.getToolsSchema();
    
    // 构建系统提示
    const skillsContext = agent.skills
      .filter(s => s.enabled)
      .map(s => {
        const skill = s.skill;
        const tools = JSON.parse(skill.tools || '[]');
        return `Skill: ${skill.name}
Description: ${skill.description}
Tools: ${tools.map((t: any) => t.name || t).join(', ') || '无'}`;
      })
      .join('\n\n');

    const systemPrompt = agent.systemPrompt + 
      (skillsContext ? `\n\nAvailable Skills:\n${skillsContext}` : '');

    // 构建消息列表
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...historyMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    // 添加工具描述到系统提示
    if (availableTools.length > 0) {
      const toolDescriptions = availableTools
        .map(t => `- ${t.function.name}: ${t.function.description}`)
        .join('\n');
      
      messages[0].content += `\n\nAvailable Tools:\n${toolDescriptions}\n\nWhen you need to use a tool, respond in this JSON format:
{"tool": "tool_name", "params": {"param1": "value1", ...}}`;
    }

    // 调用 DeepSeek
    let assistantContent: string;
    let toolCalls: ToolCallMessage[] = [];
    let hasToolCalls = false;
    
    try {
      const modelConfig = JSON.parse(agent.modelConfig || '{}');
      const response = await deepseekService.chat({
        messages,
        model: modelConfig.model,
        temperature: modelConfig.temperature,
        maxTokens: modelConfig.maxTokens,
      });

      assistantContent = response.choices[0]?.message?.content || 'No response';
      
      // 解析工具调用
      const parsedToolCalls = parseToolCalls(assistantContent);
      
      if (parsedToolCalls.length > 0) {
        hasToolCalls = true;
        
        // 执行工具调用
        for (const call of parsedToolCalls) {
          try {
            const result = await toolExecutor.execute(call.name, call.arguments);
            
            const toolMessage = await prisma.message.create({
              data: {
                conversationId: conversation.id,
                role: 'tool',
                content: JSON.stringify(result),
              },
            });
            
            toolCalls.push({
              id: toolMessage.id,
              role: 'tool',
              toolCallId: toolMessage.id,
              toolName: call.name,
              content: JSON.stringify(result),
              timestamp: toolMessage.createdAt,
            });
            
            // 将工具结果添加到消息历史
            messages.push({
              role: 'assistant',
              content: assistantContent,
            });
            messages.push({
              role: 'tool',
              content: JSON.stringify(result),
            });
          } catch (toolError: any) {
            const errorMsg = await prisma.message.create({
              data: {
                conversationId: conversation.id,
                role: 'tool',
                content: JSON.stringify({ error: toolError.message }),
              },
            });
            
            toolCalls.push({
              id: errorMsg.id,
              role: 'tool',
              toolCallId: errorMsg.id,
              toolName: call.name,
              content: JSON.stringify({ error: toolError.message }),
              timestamp: errorMsg.createdAt,
            });
          }
        }
        
        // 如果有工具调用，继续调用 LLM 获取最终响应
        if (toolCalls.length > 0) {
          try {
            const finalResponse = await deepseekService.chat({
              messages,
              model: modelConfig.model,
              temperature: modelConfig.temperature,
              maxTokens: modelConfig.maxTokens,
            });
            
            assistantContent = finalResponse.choices[0]?.message?.content || 
              `工具执行完成，共执行 ${toolCalls.length} 个工具。`;
          } catch {
            assistantContent = `工具执行完成，共执行 ${toolCalls.length} 个工具。`;
          }
        }
      }
    } catch (error: any) {
      console.error('DeepSeek API error:', error.message);
      assistantContent = `Error: ${error.message || 'Failed to get response from DeepSeek'}`;
    }

    // 保存助手消息
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: assistantContent,
      },
    });

    // 更新对话
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    res.json({
      success: true,
      data: {
        conversation: {
          id: conversation.id,
          title: conversation.title,
        },
        message: {
          id: assistantMessage.id,
          role: 'assistant',
          content: assistantContent,
          createdAt: assistantMessage.createdAt,
        },
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        hasToolCalls,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    console.error('Chat error:', error);
    res.status(500).json({ success: false, error: 'Chat failed' });
  }
});

// GET /api/chat/status - 检查配置状态
router.get('/status', async (_req, res) => {
  res.json({
    success: true,
    data: {
      configured: deepseekService.isConfigured(),
      availableTools: toolExecutor.getTools().map(t => ({
        name: t.name,
        description: t.description,
      })),
    },
  });
});

// GET /api/chat/tools - 获取可用工具列表
router.get('/tools', async (_req, res) => {
  res.json({
    success: true,
    data: toolExecutor.getToolsSchema(),
  });
});

// POST /api/chat/stream - 流式发送消息
router.post('/stream', async (req, res) => {
  try {
    const { agentId, content, conversationId } = SendMessageSchema.parse(req.body);

    // 获取 Agent
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        skills: {
          include: { skill: true },
        },
      },
    });

    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    if (!agent.enabled) {
      return res.status(400).json({ success: false, error: 'Agent is disabled' });
    }

    // 获取或创建对话
    let conversation;
    if (conversationId) {
      conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });
    }

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          agentId,
          title: `Chat ${new Date().toLocaleString()}`,
        },
      });
    }

    // 保存用户消息
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content,
      },
    });

    // 构建消息历史
    const historyMessages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
    });

    // 获取工具定义
    const availableTools = toolExecutor.getToolsSchema();

    // 构建系统提示
    const skillsContext = agent.skills
      .filter(s => s.enabled)
      .map(s => {
        const skill = s.skill;
        const tools = JSON.parse(skill.tools || '[]');
        return `Skill: ${skill.name}
Description: ${skill.description}
Tools: ${tools.map((t: any) => t.name || t).join(', ') || '无'}`;
      })
      .join('\n\n');

    const systemPrompt = agent.systemPrompt +
      (skillsContext ? `\n\nAvailable Skills:\n${skillsContext}` : '');

    // 构建消息列表
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...historyMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    // 添加工具描述到系统提示
    if (availableTools.length > 0) {
      const toolDescriptions = availableTools
        .map(t => `- ${t.function.name}: ${t.function.description}`)
        .join('\n');

      messages[0].content += `\n\nAvailable Tools:\n${toolDescriptions}\n\nWhen you need to use a tool, respond in this JSON format:
{"tool": "tool_name", "params": {"param1": "value1", ...}}`;
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const modelConfig = JSON.parse(agent.modelConfig || '{}');
    let fullContent = '';
    let hasError = false;

    try {
      await deepseekService.chatStream(
        {
          messages,
          model: modelConfig.model,
          temperature: modelConfig.temperature,
          maxTokens: modelConfig.maxTokens,
        },
        (chunk) => {
          fullContent += chunk;
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
        }
      );
    } catch (error: any) {
      hasError = true;
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    }

    // 解析工具调用
    const parsedToolCalls = parseToolCalls(fullContent);

    if (parsedToolCalls.length > 0 && !hasError) {
      res.write(`data: ${JSON.stringify({ type: 'tool_start', count: parsedToolCalls.length })}\n\n`);

      let toolCallResults: ToolCallMessage[] = [];

      // 执行工具调用
      for (const call of parsedToolCalls) {
        try {
          const result = await toolExecutor.execute(call.name, call.arguments);

          const toolMessage = await prisma.message.create({
            data: {
              conversationId: conversation.id,
              role: 'tool',
              content: JSON.stringify(result),
            },
          });

          const toolResult: ToolCallMessage = {
            id: toolMessage.id,
            role: 'tool',
            toolCallId: toolMessage.id,
            toolName: call.name,
            content: JSON.stringify(result),
            timestamp: toolMessage.createdAt,
          };

          toolCallResults.push(toolResult);
          res.write(`data: ${JSON.stringify({ type: 'tool_result', ...toolResult })}\n\n`);
        } catch (toolError: any) {
          const errorMsg = await prisma.message.create({
            data: {
              conversationId: conversation.id,
              role: 'tool',
              content: JSON.stringify({ error: toolError.message }),
            },
          });

          const toolResult: ToolCallMessage = {
            id: errorMsg.id,
            role: 'tool',
            toolCallId: errorMsg.id,
            toolName: call.name,
            content: JSON.stringify({ error: toolError.message }),
            timestamp: errorMsg.createdAt,
          };

          toolCallResults.push(toolResult);
          res.write(`data: ${JSON.stringify({ type: 'tool_result', ...toolResult })}\n\n`);
        }
      }

      // 如果有工具调用，继续调用 LLM 获取最终响应
      if (toolCallResults.length > 0) {
        res.write(`data: ${JSON.stringify({ type: 'continue', message: '工具执行完成，正在生成回复...' })}\n\n`);

        messages.push({ role: 'assistant', content: fullContent });
        for (const tc of toolCallResults) {
          messages.push({ role: 'tool', content: tc.content });
        }

        let finalContent = '';
        try {
          await deepseekService.chatStream(
            {
              messages,
              model: modelConfig.model,
              temperature: modelConfig.temperature,
              maxTokens: modelConfig.maxTokens,
            },
            (chunk) => {
              finalContent += chunk;
              res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
            }
          );
        } catch {
          finalContent = `工具执行完成，共执行 ${toolCallResults.length} 个工具。`;
        }

        fullContent = finalContent;
      }
    }

    // 保存助手消息
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: fullContent,
      },
    });

    // 更新对话
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    // 发送完成事件
    res.write(`data: ${JSON.stringify({
      type: 'done',
      conversation: {
        id: conversation.id,
        title: conversation.title,
      },
      message: {
        id: assistantMessage.id,
        role: 'assistant',
        content: fullContent,
        createdAt: assistantMessage.createdAt,
      },
    })}\n\n`);

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.errors })}\n\n`);
    } else {
      console.error('Chat stream error:', error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Chat failed' })}\n\n`);
    }
    res.end();
  }
});

export default router;
