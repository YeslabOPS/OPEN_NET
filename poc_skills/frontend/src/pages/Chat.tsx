import { useState, useRef, useEffect } from 'react';
import { Select, Input, Button, List, Card, Typography, Space, Spin, Alert, message, Tag, Collapse } from 'antd';
import { SendOutlined, RobotOutlined, UserOutlined, ClearOutlined, ThunderboltOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { agentApi } from '../api/agent';
import { Agent } from '../api/agent';
import apiClient from '../api';

const { TextArea } = Input;
const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;

interface ToolCall {
  id: string;
  role: 'tool';
  toolCallId: string;
  toolName: string;
  content: string;
  timestamp: Date;
}

interface MessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  hasToolCalls?: boolean;
  isStreaming?: boolean;
}

function Chat() {
  const { agentId } = useParams<{ agentId?: string }>();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [agentLoading, setAgentLoading] = useState(true);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(true);
  const [availableTools, setAvailableTools] = useState<any[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const streamingContentRef = useRef<string>('');
  const currentAssistantIdRef = useRef<string>('');

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    loadAgents();
    checkApiStatus();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const checkApiStatus = async () => {
    try {
      const response = await apiClient.get('/chat/status');
      setApiKeyConfigured(response.configured ?? false);
      setAvailableTools(response.availableTools || []);
    } catch {
      // ignore
    }
  };

  const loadAgents = async () => {
    setAgentLoading(true);
    try {
      const data = await agentApi.list();
      const agentList = Array.isArray(data) ? data : [];
      setAgents(agentList);
      if (agentId) {
        setSelectedAgentId(agentId);
      } else if (agentList.length > 0) {
        setSelectedAgentId(agentList[0].id);
      }
    } catch {
      message.error('加载 Agent 列表失败');
    } finally {
      setAgentLoading(false);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || loading || !selectedAgentId) return;

    const userMessage: MessageItem = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setLoading(true);

    const tempAssistantId = `temp-${Date.now()}`;
    currentAssistantIdRef.current = tempAssistantId;
    streamingContentRef.current = '';

    const tempAssistantMessage: MessageItem = {
      id: tempAssistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };
    setMessages((prev) => [...prev, tempAssistantMessage]);

    try {
      const response = await fetch('http://localhost:8000/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId: selectedAgentId,
          content: inputValue,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('Cannot read stream');
      }

      let toolCalls: ToolCall[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);

              switch (parsed.type) {
                case 'chunk':
                  streamingContentRef.current += parsed.content;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === tempAssistantId
                        ? { ...msg, content: streamingContentRef.current }
                        : msg
                    )
                  );
                  break;

                case 'tool_result':
                  toolCalls.push({
                    id: parsed.id,
                    role: 'tool',
                    toolCallId: parsed.toolCallId,
                    toolName: parsed.toolName,
                    content: parsed.content,
                    timestamp: new Date(parsed.timestamp),
                  });
                  break;

                case 'done':
                  break;

                case 'error':
                  throw new Error(parsed.error || 'Stream error');
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === tempAssistantId
            ? {
                ...msg,
                isStreaming: false,
                content: streamingContentRef.current || msg.content,
                toolCalls: toolCalls,
                hasToolCalls: toolCalls.length > 0,
              }
            : msg
        )
      );
    } catch (err: any) {
      setMessages((prev) => prev.filter((msg) => msg.id !== tempAssistantId));
      message.error(err.message || '发送消息失败');

      const errorMessage: MessageItem = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `抱歉，发生了错误：${err.message || '未知错误'}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([]);
  };

  const currentAgent = agents.find(a => a.id === selectedAgentId);

  const renderToolCalls = (toolCalls: ToolCall[]) => {
    if (!toolCalls || toolCalls.length === 0) return null;

    return (
      <Collapse ghost style={{ marginTop: 8 }}>
        <Panel
          header={
            <Space>
              <ThunderboltOutlined style={{ color: '#fa8c16' }} />
              <Text strong>工具调用 ({toolCalls.length})</Text>
            </Space>
          }
          key="tools"
        >
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            {toolCalls.map((tool, index) => {
              let toolResult: any = null;
              try {
                toolResult = JSON.parse(tool.content);
              } catch {
                toolResult = { content: tool.content };
              }

              const isSuccess = toolResult.success !== false && !toolResult.error;

              return (
                <Card
                  key={tool.toolCallId || index}
                  size="small"
                  style={{
                    backgroundColor: isSuccess ? '#f6ffed' : '#fff2f0',
                    borderColor: isSuccess ? '#b7eb8f' : '#ffccc7',
                  }}
                  bodyStyle={{ padding: '8px 12px' }}
                >
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Space>
                      {isSuccess ? (
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                      ) : (
                        <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                      )}
                      <Tag color="blue">{tool.toolName}</Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        <ClockCircleOutlined /> {tool.timestamp.toLocaleTimeString()}
                      </Text>
                    </Space>

                    {toolResult.error ? (
                      <Text type="danger" style={{ fontSize: 12 }}>
                        错误: {toolResult.error}
                      </Text>
                    ) : (
                      <>
                        {toolResult.stdout && (
                          <Paragraph
                            type="secondary"
                            style={{ fontSize: 12, margin: 0, fontFamily: 'monospace' }}
                            ellipsis={{ rows: 3, expandable: true, symbol: '更多' }}
                          >
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                              {toolResult.stdout}
                            </pre>
                          </Paragraph>
                        )}
                        {toolResult.results && Array.isArray(toolResult.results) && (
                          <div>
                            {toolResult.results.map((r: any, i: number) => (
                              <div key={i} style={{ marginBottom: 4 }}>
                                <Text style={{ fontSize: 11 }} type="secondary">
                                  {r.command}:
                                </Text>
                                <pre style={{
                                  fontSize: 11,
                                  margin: '2px 0 0 0',
                                  whiteSpace: 'pre-wrap',
                                  fontFamily: 'monospace',
                                  maxHeight: 60,
                                  overflow: 'auto',
                                  backgroundColor: '#fafafa',
                                  padding: 4,
                                  borderRadius: 4,
                                }}>
                                  {r.stdout || r.error || '无输出'}
                                </pre>
                              </div>
                            ))}
                          </div>
                        )}
                        {toolResult.device && (
                          <Tag icon={<CheckCircleOutlined />} color="success">
                            设备: {toolResult.device}
                          </Tag>
                        )}
                      </>
                    )}
                  </Space>
                </Card>
              );
            })}
          </Space>
        </Panel>
      </Collapse>
    );
  };

  return (
    <div style={{ height: 'calc(100vh - 180px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space direction="vertical" size={0}>
          <Title level={3} style={{ margin: 0 }}>智能对话</Title>
          {availableTools.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              <ThunderboltOutlined /> 可用工具: {availableTools.map(t => t.name).join(', ')}
            </Text>
          )}
        </Space>
        <Space>
          <Select
            value={selectedAgentId}
            onChange={setSelectedAgentId}
            style={{ width: 200 }}
            loading={agentLoading}
            placeholder="选择 Agent"
            options={agents.map(a => ({ value: a.id, label: a.name }))}
          />
          <Button icon={<ClearOutlined />} onClick={handleClear}>
            清空
          </Button>
        </Space>
      </div>

      {!apiKeyConfigured && (
        <Alert
          message="API Key 未配置"
          description="请在「设置」页面配置 DeepSeek API Key，否则无法使用智能对话功能。"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Card
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0 }}
      >
        <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: '#999' }}>
              <RobotOutlined style={{ fontSize: 64, marginBottom: 16 }} />
              <p>开始与 {currentAgent?.name || 'Agent'} 对话</p>
              <p style={{ fontSize: 12 }}>例如：帮我巡检 192.168.1.1 这台交换机</p>
              {availableTools.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>可用工具：</Text>
                  <div style={{ marginTop: 8 }}>
                    {availableTools.map((tool, i) => (
                      <Tag key={i} icon={<ThunderboltOutlined />} style={{ marginBottom: 4 }}>
                        {tool.name}
                      </Tag>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <List
              dataSource={messages}
              renderItem={(item) => (
                <List.Item
                  style={{
                    justifyContent: item.role === 'user' ? 'flex-end' : 'flex-start',
                    border: 'none',
                    padding: '8px 0',
                  }}
                >
                  <Card
                    size="small"
                    style={{
                      maxWidth: '80%',
                      backgroundColor: item.role === 'user' ? '#e6f4ff' : '#fff',
                      border: item.role === 'user' ? '1px solid #91caff' : '1px solid #f0f0f0',
                    }}
                    bodyStyle={{ padding: '12px 16px' }}
                  >
                    <Space direction="vertical" size={4}>
                      <Space>
                        {item.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {item.timestamp.toLocaleTimeString()}
                        </Text>
                        {item.isStreaming && (
                          <Tag color="processing" style={{ fontSize: 10 }}>
                            <LoadingOutlined spin /> 正在输入...
                          </Tag>
                        )}
                        {item.hasToolCalls && !item.isStreaming && (
                          <Tag color="orange" style={{ fontSize: 10 }}>
                            <ThunderboltOutlined /> 包含工具调用
                          </Tag>
                        )}
                      </Space>
                      <div style={{ whiteSpace: 'pre-wrap' }}>
                        {item.content}
                        {item.isStreaming && <span style={{ opacity: 0.7 }}>▊</span>}
                      </div>

                      {item.role === 'assistant' && !item.isStreaming && renderToolCalls(item.toolCalls || [])}
                    </Space>
                  </Card>
                </List.Item>
              )}
            />
          )}
          <div ref={messagesEndRef} />
        </div>

        <div
          style={{
            borderTop: '1px solid #f0f0f0',
            padding: '12px 16px',
            backgroundColor: '#fafafa',
          }}
        >
          {loading && (
            <Alert
              message={
                <Space>
                  <Spin indicator={<LoadingOutlined style={{ fontSize: 14 }} spin />} />
                  AI 正在处理中...
                </Space>
              }
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
            />
          )}
          <Space.Compact style={{ width: '100%' }}>
            <TextArea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={apiKeyConfigured ? "输入消息... (Shift+Enter 换行)" : "请先配置 API Key"}
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={loading || !selectedAgentId || !apiKeyConfigured}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              loading={loading}
              disabled={!selectedAgentId || !apiKeyConfigured}
            >
              发送
            </Button>
          </Space.Compact>
        </div>
      </Card>
    </div>
  );
}

export default Chat;
