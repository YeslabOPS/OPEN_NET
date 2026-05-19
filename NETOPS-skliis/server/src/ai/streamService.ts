import { toolDefinitions, toolHandlers } from './tools';
import { ChatMessage, ChatRequest, buildApiUrl, getDefaultConfig, loadSkillContents, buildSystemPrompt } from './service';
import { Response } from 'express';

/**
 * SSE 流式 AI Chat
 * 实时推送 reasoning_content 和最终内容
 */
export async function streamChat(
  req: ChatRequest,
  res: Response
): Promise<void> {
  const config = { ...getDefaultConfig(), ...req.config };

  // 检查 API Key
  const needsApiKey = ['deepseek', 'zhipu'].includes(config.provider);
  if (!config.apiKey && needsApiKey) {
    writeSSE(res, 'error', '缺少 API Key');
    writeSSE(res, 'done', '');
    return;
  }
  if (!config.apiKey && config.provider === 'ollama' && !config.baseUrl) {
    writeSSE(res, 'error', 'Ollama 需要设置 AI_BASE_URL');
    writeSSE(res, 'done', '');
    return;
  }

  try {
    const skillContents = await loadSkillContents(req.loaded_skills || []);
    const systemPrompt = await buildSystemPrompt(req.loaded_skills, req.selected_devices, skillContents, req.loaded_topo);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...req.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    await streamCallAIAPI(messages, config, res);
  } catch (e: any) {
    writeSSE(res, 'error', e.message);
    writeSSE(res, 'done', '');
  }
}

/**
 * SSE 辅助函数：发送事件
 */
export function writeSSE(res: Response, type: string, data: string): void {
  res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
}

/**
 * 流式调用 AI API，实时推送 reasoning_content
 * 遇到 tool_calls 时切到非流式处理后续轮次
 */
async function streamCallAIAPI(
  messages: ChatMessage[],
  config: { provider: string; apiKey: string; baseUrl: string; model: string },
  res: Response
): Promise<void> {
  const url = buildApiUrl(config.provider, config.baseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  let currentMessages = [...messages];
  let allReasoning: string[] = [];

  for (let round = 0; round < 15; round++) {
    const body: any = {
      model: config.model,
      messages: currentMessages,
      tools: toolDefinitions.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      tool_choice: 'auto',
    };

    let isStreamRound = false;

    // 第一轮用流式
    // 注意：已禁用 DeepSeek thinking 模式。该模型要求回传 reasoning_content，
    // 在工具调用多轮场景下难以全链路保证。如需启用需确保全链路传递 reasoning_content。
    if (round === 0 && config.provider === 'deepseek') {
      body.stream = true;
      isStreamRound = true;
    } else {
      body.stream = false;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      writeSSE(res, 'error', `AI API 错误 (${resp.status}): ${errText}`);
      writeSSE(res, 'done', '');
      return;
    }

    if (isStreamRound && resp.body) {
      // === 流式处理第一轮 ===
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let collectedContent = '';
      let collectedReasoning = '';
      let collectedToolCalls: { index: number; id: string; type: string; function: { name: string; arguments: string } }[] = [];
      let toolCallDetected = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const payload = trimmed.slice(6);
          if (payload === '[DONE]') continue;

          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            // reasoning_content → 实时推送并收集
            if (delta.reasoning_content) {
              collectedReasoning += delta.reasoning_content;
              writeSSE(res, 'reasoning', delta.reasoning_content);
            }

            // content
            if (delta.content) {
              collectedContent += delta.content;
            }

            // tool_calls 累加（stream 模式下分批到达）
            if (delta.tool_calls) {
              toolCallDetected = true;
              for (const tc of delta.tool_calls) {
                const existing = collectedToolCalls.find(t => t.index === tc.index);
                if (existing) {
                  // 追加参数
                  existing.function.arguments += tc.function?.arguments || '';
                } else {
                  collectedToolCalls.push({
                    index: tc.index,
                    id: tc.id || '',
                    type: tc.type || 'function',
                    function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' },
                  });
                }
              }
            }
          } catch {
            // 跳过解析失败的行
          }
        }
      }

      // 第一轮流式结束，检查是否有 tool_calls
      if (toolCallDetected && collectedToolCalls.length > 0) {
        // 构建 assistant 消息（含 tool_calls）继续处理
        // DeepSeek 要求回传 reasoning_content
        const assistantMsg: any = {
          role: 'assistant',
          content: collectedContent || '',
          tool_calls: collectedToolCalls.map(tc => ({
            id: tc.id,
            type: tc.type,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        };
        if (collectedReasoning) {
          assistantMsg.reasoning_content = collectedReasoning;
        }
        currentMessages.push(assistantMsg);

        // 执行每个 function call（结果保留在 currentMessages 中）
        for (const tc of collectedToolCalls) {
          const funcName = tc.function.name;
          const funcArgs = JSON.parse(tc.function.arguments || '{}');
          const handler = toolHandlers[funcName];

          if (!handler) {
            currentMessages.push({
              role: 'tool' as const,
              tool_call_id: tc.id,
              content: JSON.stringify({ success: false, error: `未知工具: ${funcName}` }),
            } as any);
            continue;
          }

          try {
            const result = await handler(funcArgs);
            currentMessages.push({
              role: 'tool' as const,
              tool_call_id: tc.id,
              content: JSON.stringify(result),
            } as any);
          } catch (e: any) {
            currentMessages.push({
              role: 'tool' as const,
              tool_call_id: tc.id,
              content: JSON.stringify({ success: false, error: e.message }),
            } as any);
          }
        }
        // 继续下一轮（非流式）
        continue;
      }

      // 纯文本回答（无 tool_calls）
      writeSSE(res, 'content', collectedContent);
      writeSSE(res, 'done', '');
      return;
    }

    // === 非流式处理（tool_calls 后续轮次 + 非 DeepSeek 提供商） ===
    const result: any = await resp.json();
    const choice = result.choices?.[0];
    if (!choice) {
      writeSSE(res, 'error', 'AI 返回异常');
      writeSSE(res, 'done', '');
      return;
    }

    const msg = choice.message;

    // 收集 reasoning (非流式模式下)
    if (msg.reasoning_content) {
      writeSSE(res, 'reasoning', msg.reasoning_content);
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const assistantMsg: any = {
        role: 'assistant',
        content: msg.content || '',
        tool_calls: msg.tool_calls,
      };
      if (msg.reasoning_content) {
        assistantMsg.reasoning_content = msg.reasoning_content;
      }
      currentMessages.push(assistantMsg);

      for (const tc of msg.tool_calls) {
        const funcName = tc.function.name;
        const funcArgs = JSON.parse(tc.function.arguments || '{}');
        const handler = toolHandlers[funcName];

        if (!handler) {
          currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ success: false, error: `未知工具: ${funcName}` }) } as any);
          continue;
        }
        try {
          currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(await handler(funcArgs)) } as any);
        } catch (e: any) {
          currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ success: false, error: e.message }) } as any);
        }
      }
      continue;
    }

    // 最终纯文本
    writeSSE(res, 'content', msg.content || '');
    writeSSE(res, 'done', '');
    return;
  }

  // 超过轮数，用总结 prompt
  const lastMsg: any = currentMessages[currentMessages.length - 1];
  if (lastMsg?.role === 'tool') {
    currentMessages.push({ role: 'user', content: '请用中文总结以上工具执行的结果，给出专业分析和建议。' });
    const finalBody = { model: config.model, messages: currentMessages, stream: false };
    try {
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(finalBody) });
      if (r.ok) {
        const j = await r.json();
        writeSSE(res, 'content', j.choices?.[0]?.message?.content || '处理完成');
        writeSSE(res, 'done', '');
        return;
      }
    } catch {}
  }

  writeSSE(res, 'content', lastMsg?.content || '处理完成');
  writeSSE(res, 'done', '');
}
