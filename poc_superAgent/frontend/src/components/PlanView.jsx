import { Card, Tag, Progress, Steps, Typography, Empty, Space } from "antd"
import {
  CheckCircleOutlined, CloseCircleOutlined,
  ClockCircleOutlined, SyncOutlined, MinusCircleOutlined,
  PartitionOutlined,
} from "@ant-design/icons"
import ReactMarkdown from "react-markdown"

const { Text } = Typography

const statusConfig = {
  pending: { color: "default", icon: <ClockCircleOutlined />, label: "待执行" },
  running: { color: "processing", icon: <SyncOutlined spin />, label: "执行中" },
  completed: { color: "success", icon: <CheckCircleOutlined />, label: "已完成" },
  failed: { color: "error", icon: <CloseCircleOutlined />, label: "失败" },
  skipped: { color: "warning", icon: <MinusCircleOutlined />, label: "已跳过" },
}

export default function PlanView({ plan }) {
  if (!plan || !plan.plan || !plan.plan.sub_tasks?.length) {
    return <Empty description="暂无任务计划" style={{ padding: 24 }} />
  }

  const { plan: planData, summary } = plan
  const { sub_tasks, intent } = planData

  const total = sub_tasks.length
  const completed = sub_tasks.filter((t) => t.status === "completed").length
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0

  const intentLabel = {
    network_inspection: "网络巡检",
    device_query: "设备查询",
    knowledge_query: "知识查询",
    general: "通用对话",
  }

  return (
    <Card
      size="small"
      title={
        <Space>
          <PartitionOutlined />
          <span>任务计划</span>
          <Tag color="blue">{intentLabel[intent] || intent}</Tag>
          <Tag>{total} 个子任务</Tag>
        </Space>
      }
      style={{ margin: 8 }}
    >
      <Progress percent={progress} size="small" style={{ marginBottom: 12 }} />

      <Steps
        direction="vertical"
        size="small"
        current={-1}
        items={sub_tasks.map((task) => {
          const cfg = statusConfig[task.status] || statusConfig.pending
          return {
            title: (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Text strong>{task.description}</Text>
                <Tag color={cfg.color} style={{ fontSize: 11 }}>
                  {cfg.icon} {cfg.label}
                </Tag>
              </div>
            ),
            description: (
              <div style={{ fontSize: 12, color: "#666" }}>
                {task.tool_name && (
                  <div>工具: <Text code>{task.tool_name}</Text></div>
                )}
                {task.status === "failed" && task.error && (
                  <div style={{ color: "#ff4d4f" }}>错误: {task.error}</div>
                )}
                {task.result && (
                  <div style={{
                    marginTop: 4, padding: 8, background: "#f6f8fa",
                    borderRadius: 6, maxHeight: 120, overflow: "auto",
                  }}>
                    <ReactMarkdown>{task.result}</ReactMarkdown>
                  </div>
                )}
              </div>
            ),
          }
        })}
      />

      {summary && (
        <div style={{
          marginTop: 12, padding: "8px 12px", background: "#f6ffed",
          borderRadius: 6, border: "1px solid #b7eb8f", fontSize: 13,
        }}>
          <Text>{summary}</Text>
        </div>
      )}
    </Card>
  )
}
