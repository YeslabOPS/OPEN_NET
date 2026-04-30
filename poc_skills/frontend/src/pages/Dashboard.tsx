import { Card, Row, Col, Statistic, Typography, Space } from 'antd';
import {
  RobotOutlined,
  ToolOutlined,
  MessageOutlined,
  RiseOutlined,
} from '@ant-design/icons';

const { Title } = Typography;

function Dashboard() {
  return (
    <div>
      <Title level={3}>仪表盘</Title>

      <Row gutter={16} style={{ marginTop: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="Agent 数量"
              value={0}
              prefix={<RobotOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Skill 数量"
              value={1}
              prefix={<ToolOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="对话次数"
              value={0}
              prefix={<MessageOutlined />}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="API 调用"
              value={0}
              prefix={<RiseOutlined />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 24 }}>
        <Col span={24}>
          <Card title="快速开始">
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Title level={5}>欢迎使用 NetOps Agent Skills</Title>
                <p>
                  这是一个面向计算机网络运维领域的智能 Agent 构建与运行平台。
                  基于 "Agent + Skills" 架构理念设计，为网络运维工程师提供低门槛、高可用的方式，
                  通过组合式配置快速构建专属的运维智能助手。
                </p>
              </div>
              <div>
                <Title level={5}>快速操作</Title>
                <ul>
                  <li>在 Agent 管理页面创建或选择 Agent</li>
                  <li>在 Skill 管理页面查看可用的工具集</li>
                  <li>点击"智能对话"开始与 Agent 交互</li>
                  <li>在系统配置中设置 DeepSeek API Key</li>
                </ul>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default Dashboard;
