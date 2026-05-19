import { useState, useRef, useEffect } from "react"
import {
  Input, Button, Card, Typography, Space, Spin,
  Tag, Alert,
} from "antd"
import {
  SendOutlined, RobotOutlined, UserOutlined,
  PartitionOutlined, ClearOutlined, PlusOutlined,
} from "@ant-design/icons"
import ReactMarkdown from "react-markdown"
import { streamChat, plan } from "../api/agent"
import PlanView from "./PlanView"
import useAgentStore from "../store/useAgentStore"

const { TextArea } = Input
const { Text } = Typography

export default function AgentChat() {
  const {
    sessionId, messages, isStreaming, currentPlan, showPlan,
    setSessionId, addMessage, updateLastMessage, setIsStreaming,
    setCurrentPlan, togglePlan, clearMessages, newSession, addSession,
  } = useAgentStore()

  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSend = async () => {
    const msg = input.trim()
    if (!msg || isStreaming) return
    setInput("")

    // 添加用户消息
    addMessage({ role: "user", content: msg })
    setLoading(true)

    // 获取任务计划
    try {
      const planResult = await plan(msg)
      setCurrentPlan(planResult)
    } catch {
      // plan 失败不影响对话
    }

    // 添加占位 Assistant 消息
    addMessage({ role: "assistant", content: "", isStreaming: true })
    setIsStreaming(true)

    let fullContent = ""
    let newSessionId = null

    await streamChat(
      msg,
      sessionId,
      (chunk, sid) => {
        fullContent += chunk
        if (sid) newSessionId = sid
        updateLastMessage({
          content: fullContent,
          isStreaming: true,
        })
      },
      (sid) => {
        updateLastMessage({ content: fullContent, isStreaming: false })
        setIsStreaming(false)
        setLoading(false)
        if (sid) {
          setSessionId(sid)
          addSession(`对话 ${Date.now().toString().slice(-4)}`)
        }
      },
      (err) => {
        updateLastMessage({
          content: `抱歉，发生了错误: ${err}`,
          isStreaming: false,
        })
        setIsStreaming(false)
        setLoading(false)
      }
    )
  }

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleNewSession = () => {
    newSession()
    inputRef.current?.focus()
  }

  return (
    <div style={styles.container}>
      {/* 侧边栏 */}
      <div style={styles.sidebar}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          block
          onClick={handleNewSession}
          style={{ marginBottom: 16 }}
        >
          新对话
        </Button>

        {currentPlan && currentPlan.sub_tasks?.length > 0 && (
          <Button
            icon={<PartitionOutlined />}
            block
            type={showPlan ? "primary" : "default"}
            onClick={togglePlan}
            style={{ marginBottom: 8 }}
          >
            {showPlan ? "隐藏计划" : "查看计划"}
          </Button>
        )}

        <Button
          icon={<ClearOutlined />}
          block
          danger
          onClick={clearMessages}
          style={{ marginTop: 8 }}
        >
          清空对话
        </Button>
      </div>

      {/* 主区域 */}
      <div style={styles.main}>
        {/* 计划面板 */}
        {showPlan && currentPlan?.plan?.sub_tasks?.length > 0 && (
          <div style={styles.planPanel}>
            <PlanView plan={currentPlan} />
          </div>
        )}

        {/* 消息区域 */}
        <div style={styles.messageArea}>
          {messages.length === 0 && (
            <div style={styles.empty}>
              <RobotOutlined style={{ fontSize: 64, color: "#1677ff40" }} />
              <Text type="secondary" style={{ fontSize: 16, marginTop: 12 }}>
                Super Agent 网络巡检助手
              </Text>
              <Text type="secondary" style={{ marginTop: 8 }}>
                输入你的问题，开始网络设备巡检
              </Text>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                ...styles.message,
                flexDirection: msg.role === "user" ? "row-reverse" : "row",
              }}
            >
              <div
                style={{
                  ...styles.avatar,
                  background: msg.role === "user" ? "#1677ff" : "#52c41a",
                }}
              >
                {msg.role === "user" ? <UserOutlined /> : <RobotOutlined />}
              </div>
              <div
                style={{
                  ...styles.bubble,
                  background: msg.role === "user" ? "#1677ff" : "#f5f5f5",
                  color: msg.role === "user" ? "#fff" : "#000",
                }}
              >
                {msg.isStreaming && !msg.content ? (
                  <Spin size="small" />
                ) : (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 */}
        <div style={styles.inputArea}>
          <TextArea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的问题... (Shift+Enter 换行)"
            rows={2}
            disabled={isStreaming}
            style={{ resize: "none", borderRadius: 8 }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={loading}
            disabled={!input.trim() || isStreaming}
            style={{ height: 40, borderRadius: 8 }}
          >
            发送
          </Button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  container: {
    display: "flex",
    height: "100vh",
    width: "100%",
  },
  sidebar: {
    width: 200,
    borderRight: "1px solid #f0f0f0",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    background: "#fafafa",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    position: "relative",
  },
  planPanel: {
    borderBottom: "1px solid #f0f0f0",
    maxHeight: "30vh",
    overflow: "auto",
  },
  messageArea: {
    flex: 1,
    overflow: "auto",
    padding: "16px 24px",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
  message: {
    display: "flex",
    marginBottom: 16,
    alignItems: "flex-start",
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    flexShrink: 0,
    fontSize: 16,
  },
  bubble: {
    maxWidth: "70%",
    padding: "12px 16px",
    borderRadius: 12,
    lineHeight: 1.6,
    fontSize: 14,
  },
  inputArea: {
    display: "flex",
    gap: 8,
    padding: "12px 24px",
    borderTop: "1px solid #f0f0f0",
    background: "#fff",
    alignItems: "flex-end",
  },
}
