import { useState, useEffect } from 'react';
import { Table, Button, Space, Tag, Card, Typography, message, Modal, Form, Input, Switch } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, RobotOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { agentApi, Agent, CreateAgentInput } from '../../api/agent';

const { Title } = Typography;
const { TextArea } = Input;

function AgentList() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [form] = Form.useForm();

  const loadAgents = async () => {
    setLoading(true);
    try {
      const data = await agentApi.list();
      setAgents(Array.isArray(data) ? data : []);
    } catch (err) {
      message.error('加载 Agent 失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgents();
  }, []);

  const handleCreate = () => {
    setEditingAgent(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (record: Agent) => {
    setEditingAgent(record);
    form.setFieldsValue({
      name: record.name,
      description: record.description,
      systemPrompt: record.systemPrompt,
      enabled: record.enabled,
    });
    setModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await agentApi.delete(id);
      message.success('删除成功');
      loadAgents();
    } catch {
      message.error('删除失败');
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingAgent) {
        await agentApi.update(editingAgent.id, values);
        message.success('更新成功');
      } else {
        await agentApi.create(values as CreateAgentInput);
        message.success('创建成功');
      }
      setModalVisible(false);
      loadAgents();
    } catch (err) {
      message.error('操作失败');
      console.error(err);
    }
  };

  const columns: ColumnsType<Agent> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text) => (
        <Space>
          <RobotOutlined />
          {text}
        </Space>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (enabled) => (
        <Tag color={enabled ? 'green' : 'default'}>
          {enabled ? '已启用' : '已禁用'}
        </Tag>
      ),
    },
    {
      title: 'Skills',
      key: 'skillsCount',
      render: (_, record) => <Tag>{record._count?.skills || 0}</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date) => new Date(date).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} size="small" onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Button type="link" danger icon={<DeleteOutlined />} size="small" onClick={() => handleDelete(record.id)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={3}>Agent 管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          新建 Agent
        </Button>
      </div>

      <Card style={{ marginTop: 16 }}>
        <Table
          columns={columns}
          dataSource={agents}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          locale={{
            emptyText: (
              <div style={{ padding: '48px 0' }}>
                <RobotOutlined style={{ fontSize: 48, color: '#ccc', marginBottom: 16 }} />
                <p>暂无 Agent，请点击右上角按钮创建</p>
              </div>
            ),
          }}
        />
      </Card>

      <Modal
        title={editingAgent ? '编辑 Agent' : '新建 Agent'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="Agent 名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="简短描述" />
          </Form.Item>
          <Form.Item name="systemPrompt" label="系统提示词" rules={[{ required: true, message: '请输入系统提示词' }]}>
            <TextArea rows={4} placeholder="定义 Agent 的行为和角色..." />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default AgentList;
