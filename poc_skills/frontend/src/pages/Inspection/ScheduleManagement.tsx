/**
 * 定时任务管理 Tab (OP55, OP56, OP57)
 * 展示 cron 表达式、关联模板、启用/禁用开关、手动触发按钮
 */

import { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Typography,
  Tag,
  Switch,
  Modal,
  Form,
  Select,
  Input,
  message,
  Popconfirm,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  PlayCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import {
  getSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  triggerSchedule,
  getTemplates,
  InspectionSchedule,
  InspectionTemplate,
} from '../../api/inspection';
import { agentApi } from '../../api/agent';
import { Agent } from '../../api/agent';

const { Title, Text } = Typography;

function ScheduleManagement() {
  const [schedules, setSchedules] = useState<InspectionSchedule[]>([]);
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<InspectionSchedule | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [scheduleData, templateData, agentData] = await Promise.all([
        getSchedules(),
        getTemplates(),
        agentApi.list(),
      ]);
      setSchedules(scheduleData || []);
      setTemplates(templateData || []);
      setAgents(Array.isArray(agentData) ? agentData : []);
    } catch {
      message.error('加载定时任务失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSchedule = () => {
    setEditingSchedule(null);
    form.resetFields();
    form.setFieldsValue({ enabled: true });
    setModalVisible(true);
  };

  const handleEditSchedule = (schedule: InspectionSchedule) => {
    setEditingSchedule(schedule);
    form.setFieldsValue({
      templateId: schedule.templateId,
      agentId: schedule.agentId,
      cronExpression: schedule.cronExpression,
      enabled: schedule.enabled,
    });
    setModalVisible(true);
  };

  const handleDeleteSchedule = async (id: string) => {
    try {
      await deleteSchedule(id);
      message.success('删除成功');
      loadData();
    } catch (err: any) {
      message.error(err.message || '删除失败');
    }
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    try {
      await updateSchedule(id, { enabled });
      message.success(enabled ? '定时任务已启用' : '定时任务已禁用');
      loadData();
    } catch (err: any) {
      message.error(err.message || '操作失败');
    }
  };

  const handleTriggerNow = async (id: string) => {
    setTriggeringId(id);
    try {
      await triggerSchedule(id);
      message.success('巡检已开始执行');
    } catch (err: any) {
      message.error(err.message || '触发失败');
    } finally {
      setTriggeringId(null);
    }
  };

  const handleSaveSchedule = async () => {
    try {
      const values = await form.validateFields();

      if (editingSchedule) {
        await updateSchedule(editingSchedule.id, values);
        message.success('更新成功');
      } else {
        await createSchedule(values);
        message.success('创建成功');
      }

      setModalVisible(false);
      loadData();
    } catch (err: any) {
      if (!err.fields) {
        message.error(err.message || '保存失败');
      }
    }
  };

  const getLastRunStatusTag = (status?: string) => {
    if (!status) return <Text type="secondary">未执行</Text>;
    switch (status) {
      case 'success':
        return <Tag icon={<CheckCircleOutlined />} color="success">成功</Tag>;
      case 'failed':
        return <Tag icon={<CloseCircleOutlined />} color="error">失败</Tag>;
      default:
        return <Tag>{status}</Tag>;
    }
  };

  const columns = [
    {
      title: '定时表达式',
      dataIndex: 'cronExpression',
      key: 'cronExpression',
      width: 150,
      render: (cron: string, record: InspectionSchedule) => (
        <Space direction="vertical" size={0}>
          <Text code>{cron}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {record.cronDescription || ''}
          </Text>
        </Space>
      ),
    },
    {
      title: '关联模板',
      dataIndex: ['template', 'name'],
      key: 'template',
      render: (name: string, record: InspectionSchedule) => (
        <Space direction="vertical" size={0}>
          <Text>{name}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {record.template?.deviceType}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Agent',
      dataIndex: ['agent', 'name'],
      key: 'agent',
      render: (name: string) => name || '-',
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 100,
      render: (enabled: boolean, record: InspectionSchedule) => (
        <Switch
          checked={enabled}
          onChange={checked => handleToggleEnabled(record.id, checked)}
          checkedChildren="启用"
          unCheckedChildren="禁用"
        />
      ),
    },
    {
      title: '上次执行',
      key: 'lastRun',
      width: 180,
      render: (_: any, record: InspectionSchedule) => (
        <Space direction="vertical" size={0}>
          {record.lastRunTime ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {new Date(record.lastRunTime).toLocaleString('zh-CN')}
            </Text>
          ) : (
            <Text type="secondary">从未执行</Text>
          )}
          {getLastRunStatusTag(record.lastRunStatus)}
        </Space>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (time: string) => new Date(time).toLocaleDateString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: InspectionSchedule) => (
        <Space>
          <Tooltip title="立即执行">
            <Button
              type="text"
              icon={<PlayCircleOutlined />}
              onClick={() => handleTriggerNow(record.id)}
              loading={triggeringId === record.id}
            />
          </Tooltip>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => handleEditSchedule(record)}
          />
          <Popconfirm
            title="确定要删除这个定时任务吗？"
            onConfirm={() => handleDeleteSchedule(record.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          <ClockCircleOutlined /> 定时任务管理
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateSchedule}>
          新建定时任务
        </Button>
      </div>

      <Card bodyStyle={{ padding: 0 }}>
        <Table
          columns={columns}
          dataSource={schedules}
          rowKey="id"
          loading={loading}
          pagination={false}
          locale={{ emptyText: '暂无定时任务，点击上方按钮创建' }}
        />
      </Card>

      {/* 新建/编辑定时任务 Modal */}
      <Modal
        title={editingSchedule ? '编辑定时任务' : '新建定时任务'}
        open={modalVisible}
        onOk={handleSaveSchedule}
        onCancel={() => setModalVisible(false)}
        width={500}
        okText={editingSchedule ? '保存' : '创建'}
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="templateId"
            label="巡检模板"
            rules={[{ required: true, message: '请选择巡检模板' }]}
          >
            <Select
              placeholder="选择巡检模板"
              showSearch
              optionFilterProp="label"
              options={templates.map(t => ({
                value: t.id,
                label: `${t.name} (${t.devices?.length || 0}台)`,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="agentId"
            label="Agent"
            rules={[{ required: true, message: '请选择 Agent' }]}
          >
            <Select
              placeholder="选择 Agent"
              options={agents.map(a => ({ value: a.id, label: a.name }))}
            />
          </Form.Item>

          <Form.Item
            name="cronExpression"
            label="Cron 表达式"
            rules={[{ required: true, message: '请输入 cron 表达式' }]}
            extra={
              <div>
                <Text type="secondary">常用表达式示例：</Text>
                <div style={{ marginTop: 4 }}>
                  <Tag onClick={() => form.setFieldsValue({ cronExpression: '0 9 * * *' })}>
                    0 9 * * * (每天9点)
                  </Tag>
                  <Tag onClick={() => form.setFieldsValue({ cronExpression: '0 9 * * 1-5' })}>
                    0 9 * * 1-5 (工作日9点)
                  </Tag>
                  <Tag onClick={() => form.setFieldsValue({ cronExpression: '0 */6 * * *' })}>
                    0 */6 * * * (每6小时)
                  </Tag>
                </div>
              </div>
            }
          >
            <Input placeholder="0 9 * * *" />
          </Form.Item>

          <Form.Item name="enabled" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default ScheduleManagement;
