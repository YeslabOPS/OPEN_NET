import { toolDefinitions, toolHandlers } from './tools';
import { runPython } from '../pythonBridge';
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SKILLS_DIR = path.join(PROJECT_ROOT, 'skills');

/* ================================================================
 * AI 服务 - 支持 DeepSeek / ZhipuAI / Ollama / 本地模式
 * ================================================================ */

// 默认 AI 配置
interface AIConfig {
  provider: 'deepseek' | 'zhipu' | 'ollama' | 'local';
  apiKey: string;
  baseUrl: string;
  model: string;
}

function getDefaultConfig(): AIConfig {
  return {
    provider: (process.env.AI_PROVIDER as any) || 'deepseek',
    apiKey: process.env.AI_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL || 'https://api.deepseek.com',
    model: process.env.AI_MODEL || 'deepseek-chat',
  };
}

/** 根据不同提供商构造 API 完整 URL */
export function buildApiUrl(provider: string, baseUrl: string): string {
  // 智谱 AI 的 baseUrl 已包含版本路径(/v4)，不要重复加 /v1
  if (provider === 'zhipu' || baseUrl.includes('/api/paas/v4')) {
    return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  }
  // DeepSeek 使用 /chat/completions（非 OpenAI 标准 /v1/chat/completions）
  if (provider === 'deepseek' || baseUrl.includes('api.deepseek.com')) {
    return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  }
  return `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface ChatRequest {
  messages: { role: string; content: string }[];
  config?: Partial<AIConfig>;
  loaded_skills?: string[];
  selected_devices?: { name: string; host: string; port: number; device_type: string; protocol?: string }[];
  loaded_topo?: string;
}

export interface ChatResponse {
  success: boolean;
  content?: string;
  reasoning?: string;
  error?: string;
}

export { getDefaultConfig };

/**
 * 加载技能包的实际内容（直接用 fs 读取，不走 Python）
 */
export async function loadSkillContents(skillNames: string[]): Promise<string> {
  if (!skillNames || skillNames.length === 0) return '';
  if (!fs.existsSync(SKILLS_DIR)) return '';

  const parts: string[] = [];

  for (const name of skillNames) {
    try {
      const safeName = path.basename(name);
      const skillDir = path.join(SKILLS_DIR, safeName);
      if (!fs.existsSync(skillDir)) continue;

      // 递归收集所有文本文件路径
      const textFiles: string[] = [];
      function collectFiles(dir: string, prefix = '') {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, e.name);
          const relPath = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isFile()) {
            // 只收录常见文本格式
            const ext = path.extname(e.name).toLowerCase();
            if (['.md', '.txt', '.json', '.yaml', '.yml', '.py', '.cfg', '.conf', '.xml', '.html', '.js', '.ts', '.csv', '.ini', ''].includes(ext)) {
              textFiles.push(relPath);
            }
          } else if (e.isDirectory() && !e.name.startsWith('.')) {
            collectFiles(fullPath, relPath);
          }
        }
      }
      collectFiles(skillDir);

      // 读取内容
      const fileContents: string[] = [];
      for (const filePath of textFiles) {
        try {
          const fullPath = path.resolve(skillDir, filePath);
          if (!fullPath.startsWith(path.resolve(skillDir))) continue;
          const content = fs.readFileSync(fullPath, 'utf-8').trim();
          if (content) {
            fileContents.push(`\n--- ${filePath} ---\n${content}`);
          }
        } catch {
          // 跳过无法读取的文件
        }
      }

      if (fileContents.length > 0) {
        parts.push(`技能包 "${name}":\n${fileContents.join('\n')}`);
      } else {
        parts.push(`技能包 "${name}"（无文本内容）`);
      }
    } catch {
      parts.push(`技能包 "${name}"（读取失败）`);
    }
  }

  return parts.join('\n\n');
}

/**
 * 构建系统提示词（包含所有工具定义和已加载的拓扑数据）
 */
export async function buildSystemPrompt(loadedSkills?: string[], selectedDevices?: { name: string; host: string; port: number; device_type: string; protocol?: string }[], skillContents?: string, loadedTopo?: string): Promise<string> {
  const toolsDesc = toolDefinitions.map(t => {
    const params = Object.entries(t.parameters.properties)
      .map(([k, v]) => `  - ${k}: ${(v as any).description}`)
      .join('\n');
    return `## ${t.name}\n${t.description}\n参数:\n${params || '  无'}`;
  }).join('\n\n');

  let prompt = `你是 NetOps AI 运维助手。使用以下工具来帮助用户配置和管理网络设备。

可用工具:
${toolsDesc}

## 工作流程

当用户要求"配置设备"或"下发配置"时，遵循以下步骤：

### Step 1: 加载拓扑（如已上传）
如果用户已上传 .topo 文件，先调用 ensp_load_topology 加载并分析网络拓扑结构，了解设备型号和连接关系。

### Step 2: 确认选中设备
用户已选中设备的完整信息（名称、IP、端口、协议、类型）已直接提供，无需调用 get_devices 匹配。

### Step 3: 加载技能知识
仔细阅读用户加载的技能包内容，理解其中的配置命令和操作流程。

### Step 4: 执行配置/命令
使用 execute_command 工具在设备上执行：
- 查看信息：传 \`command\`（单条命令）
- 配置设备：传 \`commands\`（多条命令数组），系统自动判断每条命令的视图(\<\>/\[])并处理切换
- \`host\` 和 \`port\` 从选中设备信息中获取
- 命令视图映射规则：
  - 系统视图命令（自动进入[]）：vlan、interface、ospf、bgp、ip address、stp、port、qos 等配置命令
  - 用户视图命令（保持在\<\>）：save、display、dir、ping、tracert、reboot、reset 等
  - 单字符应答（y/n）保持在当前视图
- 支持系统视图和用户视图命令混合写在 commands 数组中，系统自动处理视图切换
- 支持多条命令批量下发，适合 OSPF/VLAN/接口IP等配置场景

### ⚠️ 重要：commands 数组的编写规则
1. **绝对不要包含以下命令**（系统会自动处理）：
   - \`system-view\`、\`sys\`、\`return\`、\`quit\` → 视图切换由系统自动完成
   - 如果包含 \`return\`，会提前退出系统视图导致后面配置命令失效
   - 如果包含 \`quit\`，可能退出 CLI 会话导致所有后续命令丢失

2. ✅ **正确的做法**：只写业务命令，例如：
   - 配置：\`["sysname AR1", "interface GigabitEthernet0/0/1", "ip address 172.16.1.1 255.255.255.0"]\`
   - 查询+保存：\`["display version", "display ip interface brief", "save", "y"]\`

## 登录方式说明
- **Telnet 设备**：免账密登录，设备信息中不需要用户名和密码，直接连接使用
- **SSH 设备**：需要用户名和密码进行认证
- 系统会根据设备配置的协议自动选择登录方式

## 配置视图说明
- 配置执行器具备**视图感知能力**，会根据命令类型自动判断在用户视图(\<\>)还是系统视图([])执行
- 大部分配置命令（vlan、interface、ospf、ip address 等）会在系统视图自动执行
- 管理命令（save、display、dir 等）会在用户视图自动执行
- 你只需按逻辑顺序组织命令，不需要手动添加 system-view、return 或 quit

## 使用规则
1. 如果用户问到设备信息但未选中设备，先调用 get_devices 获取列表。已选中设备时直接使用选中信息
2. 分析完数据后给出专业建议，用中文回答
3. 配置对比结果要指出具体的增加/删除/修改的行
4. 巡检结果要给出健康评分和改进建议
5. 回答尽量简洁专业，代码/配置内容用代码块展示`;

  // 如果有加载的技能包，追加内容到提示词
  if (skillContents) {
    prompt += `\n\n## 已加载的技能包内容\n请仔细阅读以下技能包内容，理解其中的操作流程和命令，然后使用 configure_device 工具在设备上执行配置:\n\n${skillContents}\n\n`;
  } else if (loadedSkills && loadedSkills.length > 0) {
    // 降级：仅列出名称（内容加载失败时）
    prompt += `\n\n当前已加载的技能包:\n${loadedSkills.map(s => `- ${s}`).join('\n')}\n（技能内容加载失败或为空，请确认技能包包含有效的文本文件）`;
  }

  // 如果有选中的设备，直接注入完整信息
  if (selectedDevices && selectedDevices.length > 0) {
    prompt += `\n\n## 选中的设备
用户当前选中了以下设备作为操作目标（包含完整信息，无需调用 get_devices 匹配）：
${selectedDevices.map(d => `- ${d.name} (${d.host}:${d.port}, ${d.protocol || 'ssh'}, ${d.device_type})`).join('\n')}

要求：
1. 直接从以上设备信息中获取 host、port、protocol 参数
2. 使用 configure_device 工具时直接传入 host 和 port
3. 除非用户明确要求操作其他设备，否则默认操作目标就是这些设备
`;
  }

  // 如果已加载拓扑文件，预加载数据并直接注入到提示词中
  if (loadedTopo) {
    try {
      // 统一路径为正斜杠
      const safePath = loadedTopo.replace(/\\/g, '/');

      // 先确保拓扑已加载到缓存（上传时已调用过，但重启后缓存可能丢失）
      await runPython('api/runner.py', ['ensp_load_topology', safePath]);

      // 通过 Python 获取拓扑完整数据
      const output = await runPython('api/runner.py', ['ensp_get_topology_info']);
      const parseResult = JSON.parse(output);

      if (parseResult.success && parseResult.data) {
        const topo = parseResult.data;
        const devices = topo.devices || [];
        const connections = topo.connections || [];
        const summary = topo.summary || {};

        // 格式化设备信息
        let devsText = devices.map((d: any) => {
          const ifaces = (d.interfaces || []).join(', ');
          return `  - [${d.device_type}] ${d.name} (${d.model}) com_port=${d.com_port}
    接口: ${ifaces}`;
        }).join('\n');

        // 格式化连接信息
        let connsText = connections.map((c: any) => {
          return `  ${c.device_a}.${c.interface_a} <--> ${c.device_b}.${c.interface_b}`;
        }).join('\n');

        prompt += `\n\n## 已加载的拓扑文件
用户已上传拓扑文件: ${safePath}

### 拓扑数据（已从解析器获取，直接使用以下数据，不要再调用 ensp_* 工具）：

**设备列表（${summary.devices_count || devices.length} 台）:**
${devsText || '  (无设备数据)'}

**连接关系（${summary.connections_count || connections.length} 条）:**
${connsText || '  (无连接数据)'}

**注意：** 以上是解析器返回的真实数据，请基于此数据进行分析。不要再调用 ensp_load_topology、ensp_list_devices 等拓扑工具，数据已经在这里了。
`;
      } else {
        // 解析失败时的兜底
        prompt += `\n\n## 已加载的拓扑文件
路径: ${safePath}
（拓扑数据加载失败: ${parseResult.error || '未知错误'}，如需分析拓扑请调用 ensp_load_topology 工具）
`;
      }
    } catch (e: any) {
      // Python 调用失败时的兜底
      prompt += `\n\n## 已加载的拓扑文件
路径: ${loadedTopo.replace(/\\/g, '/')}
（拓扑数据预加载失败: ${e.message}，如需分析拓扑请调用 ensp_load_topology 工具）
`;
    }
  }

  return prompt;
}

/**
 * 调用 AI 并处理 Function Calling
 */
export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const config = { ...getDefaultConfig(), ...req.config };

  try {
    // 0. 加载已激活技能包的内容
    const skillContents = await loadSkillContents(req.loaded_skills || []);

    // 1. 构建消息序列
    const systemPrompt = await buildSystemPrompt(req.loaded_skills, req.selected_devices, skillContents, req.loaded_topo);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...req.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    // 2. 检测 AI API 是否可用
    const needsApiKey = ['deepseek', 'zhipu'].includes(config.provider);
    if (!config.apiKey && needsApiKey) {
      return {
        success: false,
        error: '缺少 API Key。请在项目根目录设置环境变量 AI_API_KEY，或使用 Ollama 本地模型。\n\n示例:\n  $env:AI_API_KEY="sk-xxx"\n  $env:AI_PROVIDER="deepseek"\n  $env:AI_MODEL="deepseek-chat"\n\n或使用 Ollama:\n  $env:AI_PROVIDER="ollama"\n  $env:AI_BASE_URL="http://localhost:11434"\n  $env:AI_MODEL="qwen2.5"',
      };
    }
    if (!config.apiKey && config.provider === 'ollama' && !config.baseUrl) {
      return {
        success: false,
        error: 'Ollama 需要设置 AI_BASE_URL（如 http://localhost:11434）',
      };
    }

    // 3. 调用 AI API
    return await callAIAPI(messages, config);

  } catch (e: any) {
    return { success: false, error: `AI 服务错误: ${e.message}` };
  }
}

/**
 * 调用第三方 AI API（OpenAI 兼容格式）
 */
async function callAIAPI(
  messages: ChatMessage[],
  config: AIConfig
): Promise<ChatResponse> {
  const url = buildApiUrl(config.provider, config.baseUrl);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  // 最大 15 轮 function calling（多设备配置需要多轮）
  let currentMessages = [...messages];
  /** 收集所有轮的推理过程（DeepSeek 特有） */
  const allReasoning: string[] = [];

  for (let round = 0; round < 15; round++) {
    const body: any = {
      model: config.model,
      messages: currentMessages,
      stream: false,
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

    // 已禁用 DeepSeek thinking 模式。
    // 该模型要求每次请求都回传 reasoning_content，在工具调用多轮场景下难以保证。
    // 如需启用，需确保前端-后端-API 全链路正确传递 reasoning_content 字段。

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { success: false, error: `AI API 错误 (${resp.status}): ${errText}` };
    }

    const result: any = await resp.json();
    const choice = result.choices?.[0];
    if (!choice) {
      return { success: false, error: 'AI 返回异常' };
    }

    const msg = choice.message;

    // 收集本轮推理过程
    if (msg.reasoning_content) {
      allReasoning.push(msg.reasoning_content);
    }

    // 检查是否包含 function call
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // 添加 assistant 回复（需要回传 reasoning_content，否则 DeepSeek thinking 模式会报错）
      const assistantMsg: any = {
        role: 'assistant',
        content: msg.content || '',
        tool_calls: msg.tool_calls,
      };
      if (msg.reasoning_content) {
        assistantMsg.reasoning_content = msg.reasoning_content;
      }
      currentMessages.push(assistantMsg);

      // 执行每个 function call
      for (const tc of msg.tool_calls) {
        const funcName = tc.function.name;
        const funcArgs = JSON.parse(tc.function.arguments || '{}');
        const handler = toolHandlers[funcName];

        if (!handler) {
          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ success: false, error: `未知工具: ${funcName}` }),
          } as any);
          continue;
        }

        try {
          const result = await handler(funcArgs);
          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          } as any);
        } catch (e: any) {
          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ success: false, error: e.message }),
          } as any);
        }
      }
      // 继续下一轮让 AI 分析结果
      continue;
    }

    // 纯文本回复：返回收集到的所有推理过程
    return {
      success: true,
      content: msg.content || '',
      reasoning: allReasoning.length > 0 ? allReasoning.join('\n\n---\n\n') : undefined,
    };
  }

  // 超过最大轮数，用 AI 自然语言总结工具执行结果
  const lastMsg: any = currentMessages[currentMessages.length - 1];
  if (lastMsg?.role === 'tool') {
    // 追加一条 prompt 让 AI 总结结果
    currentMessages.push({
      role: 'user',
      content: '请用中文总结以上工具执行的结果，给出专业分析和建议。如果涉及设备列表、备份、巡检等信息，用简洁清晰的格式展示。',
    });
    const finalBody: any = {
      model: config.model,
      messages: currentMessages,
      stream: false,
    };
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(finalBody),
      });
      if (resp.ok) {
        const result: any = await resp.json();
        const msg = result.choices?.[0]?.message || {};
        // 收集最终的推理过程
        if (msg.reasoning_content) {
          allReasoning.push(msg.reasoning_content);
        }
        return {
          success: true,
          content: msg.content || '处理完成',
          reasoning: allReasoning.length > 0 ? allReasoning.join('\n\n---\n\n') : undefined,
        };
      }
    } catch {
      // fallback 到原始结果
    }
    return {
      success: true,
      content: lastMsg.content || '处理完成',
      reasoning: allReasoning.length > 0 ? allReasoning.join('\n\n---\n\n') : undefined,
    };
  }
  return {
    success: true,
    content: lastMsg?.content || '处理完成',
    reasoning: allReasoning.length > 0 ? allReasoning.join('\n\n---\n\n') : undefined,
  };
}


