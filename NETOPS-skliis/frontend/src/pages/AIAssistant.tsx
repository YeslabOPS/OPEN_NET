import { useCallback, useEffect, useRef, useState } from 'react';
import { api, Device } from '../api';
import SkillSelector from '../components/SkillSelector';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
}

interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

const LS_SESSION_KEY = 'netops_last_session_id';

/** 预定义快捷问法 */
const QUICK_ACTIONS = [
  { label: '查看设备列表', text: '查看所有设备列表' },
  { label: '执行全量备份', text: '执行所有设备的配置备份' },
  { label: '巡检所有设备', text: '对全部设备执行自动化巡检' },
  { label: '查看备份文件', text: '查看所有备份文件列表' },
  { label: '检查连通性', text: '帮我检查所有设备的连通性' },
];

export default function AIAssistant() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedAction, setSelectedAction] = useState<string>('');
  const [loadedSkills, setLoadedSkills] = useState<string[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<Device[]>([]);
  const [loadedTopo, setLoadedTopo] = useState<string>('');
  const [deviceCollapsed, setDeviceCollapsed] = useState(false);
  const [aiProvider, setAiProvider] = useState<string>('local');
  const [aiModel, setAiModel] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 会话管理状态
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionInitDone, setSessionInitDone] = useState(false);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const lastSavedMessagesRef = useRef<string>('');

  /** 展开/收起推理过程的索引集合 */
  const [expandedReasoning, setExpandedReasoning] = useState<Set<number>>(new Set());
  /** 导出格式：md / html / docx */
  const [exportFormats, setExportFormats] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const exportFormatsRef = useRef<string[]>([]);
  // 保持 ref 与 state 同步
  useEffect(() => {
    exportFormatsRef.current = exportFormats;
  }, [exportFormats]);

  const messagesDigest = useCallback((msgs: ChatMsg[]): string => {
    return msgs.map(m => `${m.role}:${m.content.slice(0, 50)}`).join('|');
  }, []);

  // 加载设备列表
  useEffect(() => {
    api.getDevices().then(res => {
      if (res.success && res.data) setDevices(res.data);
    }).catch(() => {});
  }, []);

  // 加载 AI 配置
  useEffect(() => {
    api.aiConfig().then(res => {
      if (res.success && res.data) {
        setAiProvider(res.data.provider);
        setAiModel(res.data.model);
      }
    }).catch(() => {});
  }, []);

  // 初始化会话
  useEffect(() => {
    if (sessionInitDone) return;
    setSessionLoading(true);

    api.aiListSessions().then(listRes => {
      if (!listRes.success || !listRes.data) {
        setSessionLoading(false);
        setSessionInitDone(true);
        return;
      }

      const sessionList = listRes.data;
      setSessions(sessionList);

      const lastId = localStorage.getItem(LS_SESSION_KEY);
      const targetSession = lastId
        ? sessionList.find(s => s.id === lastId)
        : null;

      if (targetSession) {
        return api.aiGetSession(targetSession.id).then(getRes => {
          if (getRes.success && getRes.data) {
            const data = getRes.data;
            setMessages(data.messages || []);
            setSelectedDevices(data.selectedDevices || []);
            setLoadedSkills(data.loadedSkills || []);
            setLoadedTopo(data.loadedTopo || '');
            setCurrentSessionId(data.id);
            lastSavedMessagesRef.current = messagesDigest(data.messages || []);
          }
        });
      } else {
        return api.aiCreateSession('新会话').then(createRes => {
          if (createRes.success && createRes.data) {
            const newSession = createRes.data;
            setCurrentSessionId(newSession.id);
            localStorage.setItem(LS_SESSION_KEY, newSession.id);
            setMessages([]);
            lastSavedMessagesRef.current = '';
            return api.aiListSessions().then(r => {
              if (r.success && r.data) setSessions(r.data);
            });
          }
        });
      }
    }).finally(() => {
      setSessionLoading(false);
      setSessionInitDone(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const welcomeMessages: ChatMsg[] = [{
    role: 'assistant',
    content: `你好！我是 **NetOps AI运维助手** 🧑‍💻

我可以帮你：
- 📋 查看设备列表和设备信息
- 💾 执行配置备份和查看备份
- 🔍 执行自动化巡检并分析结果
- 📊 对比配置变更
- 🌐 检测网络连通性
- 🔌 上传并分析网络拓扑文件

请告诉我你需要什么帮助，或者点击下方快捷按钮。`,
  }];

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /** 保存当前会话 */
  const saveCurrentSession = useCallback(async (msgs: ChatMsg[], forceTitle?: string) => {
    if (!currentSessionId) return;
    const digest = messagesDigest(msgs);
    if (digest === lastSavedMessagesRef.current && !forceTitle) return;

    let title = forceTitle;
    if (!title) {
      const firstUser = msgs.find(m => m.role === 'user');
      if (firstUser) {
        title = firstUser.content.length > 40
          ? firstUser.content.slice(0, 40) + '...'
          : firstUser.content;
      }
    }

    await api.aiUpdateSession(currentSessionId, {
      messages: msgs,
      selectedDevices,
      loadedSkills,
      loadedTopo,
      title,
    });
    lastSavedMessagesRef.current = digest;

    api.aiListSessions().then(res => {
      if (res.success && res.data) setSessions(res.data);
    }).catch(() => {});
  }, [currentSessionId, selectedDevices, loadedSkills, loadedTopo, messagesDigest]);

  /** 切换会话 */
  const switchSession = async (sessionId: string) => {
    if (sessionId === currentSessionId) return;
    await saveCurrentSession(messages);
    setSessionLoading(true);
    try {
      const res = await api.aiGetSession(sessionId);
      if (res.success && res.data) {
        const data = res.data;
        setMessages(data.messages || []);
        setSelectedDevices(data.selectedDevices || []);
        setLoadedSkills(data.loadedSkills || []);
        setLoadedTopo(data.loadedTopo || '');
        setCurrentSessionId(data.id);
        localStorage.setItem(LS_SESSION_KEY, data.id);
        lastSavedMessagesRef.current = messagesDigest(data.messages || []);
        setExpandedReasoning(new Set());
      }
    } finally {
      setSessionLoading(false);
    }
  };

  /** 创建新会话 */
  const createNewSession = async () => {
    if (!currentSessionId) return;
    await saveCurrentSession(messages);
    try {
      const res = await api.aiCreateSession('新会话');
      if (res.success && res.data) {
        const newSession = res.data;
        setCurrentSessionId(newSession.id);
        localStorage.setItem(LS_SESSION_KEY, newSession.id);
        setMessages([]);
        setSelectedDevices([]);
        setLoadedSkills([]);
        setLoadedTopo('');
        setExpandedReasoning(new Set());
        lastSavedMessagesRef.current = '';
        const listRes = await api.aiListSessions();
        if (listRes.success && listRes.data) setSessions(listRes.data);
      }
    } catch (e) {
      console.error('创建会话失败', e);
    }
  };

  /** 删除会话 */
  const deleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (sessions.length <= 1) {
      alert('至少保留一个会话');
      return;
    }
    if (!window.confirm('确定删除此会话？此操作不可恢复。')) return;

    try {
      await api.aiDeleteSession(sessionId);
      const listRes = await api.aiListSessions();
      if (listRes.success && listRes.data) {
        setSessions(listRes.data);
        if (sessionId === currentSessionId) {
          const nextSession = listRes.data[0];
          if (nextSession) {
            await switchSession(nextSession.id);
          } else {
            const cr = await api.aiCreateSession('新会话');
            if (cr.success && cr.data) {
              setCurrentSessionId(cr.data.id);
              localStorage.setItem(LS_SESSION_KEY, cr.data.id);
              setMessages([]);
              lastSavedMessagesRef.current = '';
            }
          }
        }
      }
    } catch (e) {
      console.error('删除会话失败', e);
    }
  };

  // 发送消息（流式）
  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const displayMsgs = messages.length === 0 ? welcomeMessages : [];
    const userMsg: ChatMsg = { role: 'user', content: text.trim() };
    const newMessages = [...displayMsgs, ...messages, userMsg];

    // 添加一个占位的 assistant 消息，用于流式实时更新
    const assistantPlaceholder: ChatMsg = { role: 'assistant', content: '', reasoning: '' };
    const messagesWithPlaceholder = [...newMessages, assistantPlaceholder];
    const placeholderIndex = messagesWithPlaceholder.length - 1;
    setMessages(messagesWithPlaceholder);
    setInput('');
    setSelectedAction('');
    setLoading(true);

    let accumulatedContent = '';
    let accumulatedReasoning = '';
    let isStreamingDone = false;
    // 在 sendMessage 调用时快照当前选中的导出格式，避免 onDone 闭包捕获到旧值
    const selectedFormats = [...exportFormats];

    // 使用流式 SSE 接口（DeepSeek 支持思考模式时使用）
    api.aiChatStream(
      newMessages.map(m => ({ role: m.role, content: m.content })),
      {
        onReasoning: (text) => {
          accumulatedReasoning += text;
          setMessages(prev => {
            const updated = [...prev];
            if (updated[placeholderIndex]) {
              updated[placeholderIndex] = { ...updated[placeholderIndex], reasoning: accumulatedReasoning };
            }
            return updated;
          });
        },
        onContent: (text) => {
          accumulatedContent += text;
          setMessages(prev => {
            const updated = [...prev];
            if (updated[placeholderIndex]) {
              updated[placeholderIndex] = { ...updated[placeholderIndex], content: accumulatedContent };
            }
            return updated;
          });
        },
        onDone: async () => {
          if (isStreamingDone) return;
          isStreamingDone = true;
          setLoading(false);
          // 保存最终消息到会话（不含 placeholder 中的空白内容留空）
          const finalMessages = [...newMessages];
          if (accumulatedContent) {
            finalMessages.push({ role: 'assistant', content: accumulatedContent, reasoning: accumulatedReasoning || undefined });
          }
          await saveCurrentSession(finalMessages.length > 0 ? finalMessages : messagesWithPlaceholder);

          // 自动导出到用户选择的格式
          if (accumulatedContent && selectedFormats.length > 0) {
            setExporting(true);
            for (const format of selectedFormats) {
              try {
                const res = await api.exportContent(accumulatedContent, format as 'md' | 'html' | 'docx');
                if (res.success && res.data) {
                  // 下载文件
                  const downloadUrl = api.getDownloadUrl(res.data.filename);
                  const a = document.createElement('a');
                  a.href = downloadUrl;
                  a.download = res.data.filename;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                } else {
                  console.error(`导出 ${format} 失败:`, res.error);
                }
              } catch (e) {
                console.error(`导出 ${format} 出错:`, e);
              }
            }
            setExporting(false);
          }
        },
        onError: (err) => {
          if (isStreamingDone) return;
          isStreamingDone = true;
          setMessages(prev => {
            const updated = [...prev];
            if (updated[placeholderIndex]) {
              updated[placeholderIndex] = { ...updated[placeholderIndex], content: `❌ ${err}` };
            }
            return updated;
          });
          setLoading(false);
        },
      },
      loadedSkills,
      selectedDevices,
      loadedTopo
    );
  };

  // 处理 Enter 发送
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // 处理拓扑文件上传
  const handleTopoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.topo')) {
      const newMsgs = [...messages, { role: 'assistant' as const, content: `❌ 仅支持 .topo 格式的拓扑文件` }];
      setMessages(newMsgs);
      return;
    }

    try {
      const content = await file.text();
      const res = await api.uploadTopo(file.name, content);
      if (res.success && res.data) {
        const { filename, path: topoPath, devices_count, connections_count } = res.data;
        setLoadedTopo(topoPath.replace(/\\/g, '/'));

        const topoMsg = `📁 **拓扑文件已加载**: ${filename}\n\n`
          + `- 设备数: ${devices_count}\n`
          + `- 连接数: ${connections_count}\n\n`
          + `你可以提问"分析这个拓扑"或"帮我配置 OSPF"等。`;

        const newMsgs = [...messages, { role: 'assistant' as const, content: topoMsg }];
        setMessages(newMsgs);
        await saveCurrentSession(newMsgs);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `❌ 上传失败: ${res.error || '未知错误'}` }]);
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ 上传出错: ${e.message}` }]);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 切换推理过程展开/收起
  const toggleReasoning = (msgIndex: number) => {
    setExpandedReasoning(prev => {
      const next = new Set(prev);
      if (next.has(msgIndex)) {
        next.delete(msgIndex);
      } else {
        next.add(msgIndex);
      }
      return next;
    });
  };

  // 渲染消息内容
  const renderContent = (content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith('```')) {
        const match = part.match(/```(?:\w+)?\n?([\s\S]*?)```/);
        const code = match ? match[1].trim() : part.replace(/```/g, '').trim();
        return (
          <pre key={i} className="ai-code-block">
            <code>{code}</code>
          </pre>
        );
      }
      const lines = part.split('\n');
      return (
        <div key={i}>
          {lines.map((line, j) => {
            if (line.startsWith('## ')) {
              return <h4 key={j} className="ai-msg-h4">{line.slice(3)}</h4>;
            }
            if (line.startsWith('**') && line.endsWith('**')) {
              return <strong key={j}>{line.slice(2, -2)}</strong>;
            }
            if (line.match(/^[-*]\s/)) {
              return <div key={j} className="ai-list-item">{line}</div>;
            }
            if (line.match(/^\d+\.\s/)) {
              return <div key={j} className="ai-list-item">{line}</div>;
            }
            if (line.startsWith('> ')) {
              return <blockquote key={j} className="ai-blockquote">{line.slice(2)}</blockquote>;
            }
            return <p key={j} className={line.trim() ? '' : 'ai-empty-p'}>{line}</p>;
          })}
        </div>
      );
    });
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) {
      return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const displayMessages = messages.length === 0 && !sessionLoading ? welcomeMessages : messages;

  return (
    <div className="ai-page">
      {/* 左侧面板 */}
      <div className="ai-side-panel">
        {/* 会话列表 */}
        <div className="ai-panel-section">
          <div
            className="ai-panel-title ai-panel-title-collapsible"
            onClick={() => setSessionsCollapsed(!sessionsCollapsed)}
          >
            <span className="ai-chevron">{sessionsCollapsed ? '▶' : '▼'}</span>
            💬 历史会话
            {currentSessionId && (
              <button
                className="ai-new-session-btn"
                onClick={(e) => { e.stopPropagation(); createNewSession(); }}
                title="新建会话"
              >
                ＋
              </button>
            )}
          </div>
          {!sessionsCollapsed && (
            <div className="ai-session-list">
              {sessionLoading && sessions.length === 0 ? (
                <div className="ai-panel-hint">加载中...</div>
              ) : sessions.length === 0 ? (
                <div className="ai-panel-hint">暂无会话</div>
              ) : (
                sessions.map(s => (
                  <div
                    key={s.id}
                    className={`ai-session-item ${s.id === currentSessionId ? 'active' : ''}`}
                    onClick={() => switchSession(s.id)}
                  >
                    <div className="ai-session-info">
                      <div className="ai-session-title">{s.title}</div>
                      <div className="ai-session-meta">
                        {formatTime(s.updatedAt)} · {s.messageCount} 条消息
                      </div>
                    </div>
                    <button
                      className="ai-session-del-btn"
                      onClick={(e) => deleteSession(e, s.id)}
                      title="删除会话"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* 设备信息 */}
        <div className="ai-panel-section">
          <div className="ai-panel-title ai-panel-title-collapsible" onClick={() => setDeviceCollapsed(!deviceCollapsed)}>
            <span className="ai-chevron">{deviceCollapsed ? '▶' : '▼'}</span>
            📡 设备信息
            {selectedDevices.length > 0 && (
              <span className="ai-device-selected-count">已选 {selectedDevices.length}</span>
            )}
            {loadedTopo && <span className="ai-device-selected-count topo-badge" title={loadedTopo}>🗺 拓扑</span>}
          </div>
          {!deviceCollapsed && (
          <div className="ai-device-list">
            {devices.length === 0 ? (
              <div className="ai-panel-hint">暂无设备</div>
            ) : (
              devices.map(d => {
                const checked = selectedDevices.some(sd => sd.host === d.host && sd.port === d.port);
                return (
                  <div
                    key={`${d.host}:${d.port}`}
                    className={`ai-device-item ${checked ? 'checked' : ''}`}
                    onClick={() => {
                      setSelectedDevices(prev =>
                        checked
                          ? prev.filter(sd => !(sd.host === d.host && sd.port === d.port))
                          : [...prev, d]
                      );
                    }}
                  >
                    <input
                      type="checkbox"
                      className="ai-device-checkbox"
                      checked={checked}
                      onChange={() => {}}
                    />
                    <span className="ai-device-icon">🖥</span>
                    <div className="ai-device-info">
                      <div className="ai-device-name">{d.name || d.host}</div>
                      <div className="ai-device-ip">{d.host}</div>
                    </div>
                    <span className="ai-device-type">{d.device_type}</span>
                  </div>
                );
              })
            )}
          </div>
          )}
        </div>

        <div className="ai-panel-section">
          <div className="ai-panel-title">⚡ 快捷操作</div>
          <div className="ai-quick-actions">
            {QUICK_ACTIONS.map(action => (
              <button
                key={action.text}
                className={`ai-quick-btn ${selectedAction === action.text ? 'active' : ''}`}
                onClick={() => {
                  setSelectedAction(action.text);
                  sendMessage(action.text);
                }}
                disabled={loading}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>

        <SkillSelector selected={loadedSkills} onChange={setLoadedSkills} />

        <div className="ai-panel-section">
          <div className="ai-panel-title">ℹ️ 提示</div>
          <div className="ai-panel-hint">
            当前 AI 模式：
            <strong>{aiProvider === 'zhipu' ? '智谱 AI' : aiProvider === 'deepseek' ? 'DeepSeek' : aiProvider === 'ollama' ? 'Ollama' : '未配置'}</strong>
            {aiModel && <> · {aiModel}</>}
            <br /><br />
            左侧显示历史会话列表，点击可切换。会话自动保存。
            <br /><br />
            可在 AI 助手页左侧勾选技能和设备后发送消息，
            AI 将自动读取技能内容并操作设备。
            <br /><br />
            支持上传 📎 .topo 拓扑文件，AI 将自动分析网络结构。
            {aiProvider === 'local' && <><br /><br />
            ⚠️ 当前未设置 API Key。请在项目根目录设置环境变量：<br />
            <code>$env:AI_API_KEY="sk-xxx"</code><br />
            <code>$env:AI_PROVIDER="deepseek"</code></>}
          </div>
        </div>
      </div>

      {/* 右侧对话区域 */}
      <div className="ai-chat-area">
        {sessionLoading && messages.length === 0 && (
          <div className="ai-messages">
            <div className="ai-loading-hint">正在加载会话...</div>
          </div>
        )}
        <div className="ai-messages" style={sessionLoading && messages.length === 0 ? { display: 'none' } : undefined}>
          {displayMessages.map((msg, msgIndex) => (
            <div key={msgIndex} className={`ai-message ${msg.role}`}>
              <div className="ai-avatar">
                {msg.role === 'assistant' ? '🤖' : '👤'}
              </div>
              <div className="ai-bubble">
                {/* 推理过程（仅 assistant 有） */}
                {msg.role === 'assistant' && msg.reasoning && (
                  <div className="ai-reasoning-block">
                    <div
                      className="ai-reasoning-header"
                      onClick={() => toggleReasoning(msgIndex)}
                    >
                      <span className="ai-reasoning-toggle">
                        {expandedReasoning.has(msgIndex) ? '▼' : '▶'}
                      </span>
                      <span className="ai-reasoning-label">🤔 思考过程</span>
                    </div>
                    {expandedReasoning.has(msgIndex) && (
                      <div className="ai-reasoning-content">
                        {msg.reasoning}
                      </div>
                    )}
                  </div>
                )}
                {renderContent(msg.content)}
              </div>
            </div>
          ))}

          {loading && (
            <div className="ai-message assistant">
              <div className="ai-avatar">🤖</div>
              <div className="ai-bubble">
                <div className="ai-typing">
                  <span className="ai-dot">.</span>
                  <span className="ai-dot">.</span>
                  <span className="ai-dot">.</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="ai-input-area">
          <div className="ai-export-bar">
            <span className="ai-export-label">导出格式：</span>
            {['md', 'html', 'docx'].map(fmt => (
              <label key={fmt} className="ai-export-checkbox" title={fmt === 'md' ? '导出为 Markdown 文件' : fmt === 'html' ? '导出为 HTML 文件' : '导出为 Word 文档'}>
                <input
                  type="checkbox"
                  checked={exportFormats.includes(fmt)}
                  onChange={(e) => {
                    setExportFormats(prev =>
                      e.target.checked ? [...prev, fmt] : prev.filter(f => f !== fmt)
                    );
                  }}
                  disabled={loading || exporting}
                />
                <span>{fmt === 'md' ? '.md' : fmt === 'html' ? '.html' : '.docx'}</span>
              </label>
            ))}
            {exporting && <span className="ai-exporting-hint">导出中...</span>}
          </div>
          <div className="ai-input-row">
            <input
              ref={fileInputRef}
              type="file"
              accept=".topo"
              style={{ display: 'none' }}
              onChange={handleTopoUpload}
            />
            <button
              className="ai-upload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              title="上传 .topo 拓扑文件"
            >
              📎
            </button>
            <textarea
              ref={inputRef}
              className="ai-input"
              placeholder="输入你的问题... (Enter 发送, Shift+Enter 换行)"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={loading}
            />
            <button
              className="ai-send-btn"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
            >
              {loading ? '...' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
