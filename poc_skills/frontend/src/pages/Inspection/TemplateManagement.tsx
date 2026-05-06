/**
 * 巡检模板管理 Tab (OP36)
 * 卡片式展示，新建/编辑/删除模板
 */

import { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Space,
  Typography,
  Modal,
  Form,
  Input,
  Select,
  message,
  Popconfirm,
  Tag,
  Row,
  Col,
  Empty,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  testSSHConnection,
  InspectionTemplate,
  InspectionDevice,
} from '../../api/inspection';

const { Title, Text } = Typography;
const { TextArea } = Input;

const defaultCommands: Record<string, string[]> = {
  switch: [
    'display version',
    'display interface brief',
    'display vlan',
    'display stp brief',
    'display cpu-usage',
    'display memory-usage',
  ],
  router: [
    'display version',
    'display interface brief',
    'display ip routing-table',
    'display bgp peer',
    'display cpu-usage',
    'display memory-usage',
  ],
  firewall: [
    'display version',
    'display interface',
    'display firewall session table',
    'display policy',
    'display cpu-usage',
    'display memory-usage',
  ],
  generic: [
    'display version',
    'display interface',
    'display cpu-usage',
    'display memory-usage',
  ],
};

function TemplateManagement() {
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<InspectionTemplate | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await getTemplates();
      setTemplates(data || []);
    } catch {
      message.error('加载模板列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTemplate = () => {
    setEditingTemplate(null);
    form.resetFields();
    form.setFieldsValue({
      deviceType: 'switch',
      commands: defaultCommands.switch,
      devices: [],
    });
    setModalVisible(true);
  };

  const handleEditTemplate = (template: InspectionTemplate) => {
    setEditingTemplate(template);
    form.setFieldsValue({
      name: template.name,
      description: template.description,
      deviceType: template.deviceType,
      commands: template.commands,
    });
    setModalVisible(true);
  };

  const handleDeleteTemplate = async (id: string, templateName?: string) => {
    try {
      await deleteTemplate(id);
      message.success('删除成功');
      loadTemplates();
    } catch (err: any) {
      // 检查是否是有关联记录的错误
      if (err.details) {
        Modal.confirm({
          title: '无法直接删除',
          content: (
            <div>
              <p>该模板关联了以下记录：</p>
              <ul>
                {err.details.schedules > 0 && <li>定时任务：{err.details.schedules} 个</li>}
                {err.details.records > 0 && <li>巡检记录：{err.details.records} 条</li>}
              </ul>
              <p style={{ color: '#ff4d4f', marginTop: 8 }}>
                强制删除将同时删除所有关联记录，是否继续？
              </p>
            </div>
          ),
          okText: '强制删除',
          cancelText: '取消',
          okButtonProps: { danger: true },
          onOk: async () => {
            try {
              await deleteTemplate(id, true);
              message.success('模板及关联记录已删除');
              loadTemplates();
            } catch (forceErr: any) {
              message.error(forceErr.message || '删除失败');
            }
          },
        });
      } else {
        message.error(err.message || '删除失败');
      }
    }
  };

  const handleSaveTemplate = async () => {
    try {
      const values = await form.validateFields();
      console.log('[Save] form values:', values);

      // 将 commands 从字符串转换为数组
      let commands = values.commands;
      if (typeof commands === 'string') {
        commands = commands.split('\n').map(c => c.trim()).filter(c => c);
      }
      // 确保是数组
      if (!Array.isArray(commands)) {
        commands = [];
      }

      // 处理 devices：将 port 转换为数字，并过滤掉空值
      const devices = (values.devices || []).map((d: any) => ({
        host: d.host,
        port: d.port ? parseInt(String(d.port), 10) : 22,
        username: d.username,
        password: d.password || undefined,
        privateKey: d.privateKey || undefined,
        deviceType: d.deviceType || undefined,
      }));

      // 处理 description：转换为 undefined 而不是 null
      const description = values.description || undefined;

      const templateData = {
        name: values.name,
        description,
        deviceType: values.deviceType,
        commands,
        devices,
      };
      console.log('[Save] templateData:', templateData);

      if (editingTemplate) {
        const response = await updateTemplate(editingTemplate.id, templateData);
        console.log('[Save] update response:', response);
        message.success('更新成功');
      } else {
        const response = await createTemplate(templateData);
        console.log('[Save] create response:', response);
        message.success('创建成功');
      }

      setModalVisible(false);
      loadTemplates();
    } catch (err: any) {
      console.error('[Save] error:', err);
      if (!err.fields) {
        message.error(err.message || '保存失败');
      }
    }
  };

  const handleDeviceTypeChange = (deviceType: string) => {
    if (!editingTemplate) {
      form.setFieldsValue({
        commands: defaultCommands[deviceType] || defaultCommands.generic,
      });
    }
  };

  const getDeviceTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      switch: 'blue',
      router: 'green',
      firewall: 'orange',
      generic: 'default',
    };
    return colors[type] || 'default';
  };

  const getDeviceTypeName = (type: string) => {
    const names: Record<string, string> = {
      switch: '交换机',
      router: '路由器',
      firewall: '防火墙',
      generic: '通用设备',
    };
    return names[type] || '通用设备';
  };

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
          巡检模板管理
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateTemplate}>
          新建模板
        </Button>
      </div>

      {templates.length === 0 ? (
        <Empty description="暂无巡检模板" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Button type="primary" onClick={handleCreateTemplate}>
            创建第一个模板
          </Button>
        </Empty>
      ) : (
        <Row gutter={[16, 16]}>
          {templates.map(template => (
            <Col key={template.id} xs={24} sm={12} lg={8}>
              <Card
                hoverable
                actions={[
                  <Button
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => handleEditTemplate(template)}
                  >
                    编辑
                  </Button>,
                  <Popconfirm
                    title="确定要删除这个模板吗？"
                    description="删除后无法恢复，关联的定时任务也会受到影响"
                    onConfirm={() => handleDeleteTemplate(template.id)}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button type="text" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <Card.Meta
                  title={
                    <Space>
                      <Text strong>{template.name}</Text>
                      <Tag color={getDeviceTypeColor(template.deviceType)}>
                        {getDeviceTypeName(template.deviceType)}
                      </Tag>
                    </Space>
                  }
                  description={
                    <div>
                      {template.description && (
                        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                          {template.description}
                        </Text>
                      )}
                      <Space direction="vertical" size={4}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          <ThunderboltOutlined /> {template.devices?.length || 0} 台设备
                        </Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          <ClockCircleOutlined /> {template.recordCount || 0} 次巡检
                        </Text>
                        {template.scheduleCount > 0 && (
                          <Tag color="processing">{template.scheduleCount} 个定时任务</Tag>
                        )}
                      </Space>
                    </div>
                  }
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* 新建/编辑模板 Modal */}
      <Modal
        title={editingTemplate ? '编辑模板' : '新建模板'}
        open={modalVisible}
        onOk={handleSaveTemplate}
        onCancel={() => setModalVisible(false)}
        width={700}
        okText={editingTemplate ? '保存' : '创建'}
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="模板名称"
            rules={[{ required: true, message: '请输入模板名称' }]}
          >
            <Input placeholder="例如：核心交换机巡检模板" />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="模板描述（可选）" />
          </Form.Item>

          <Form.Item
            name="deviceType"
            label="设备类型"
            rules={[{ required: true, message: '请选择设备类型' }]}
          >
            <Select
              placeholder="选择设备类型"
              onChange={handleDeviceTypeChange}
              options={[
                { value: 'switch', label: '交换机 (Switch)' },
                { value: 'router', label: '路由器 (Router)' },
                { value: 'firewall', label: '防火墙 (Firewall)' },
                { value: 'generic', label: '通用设备' },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="commands"
            label="巡检命令"
            rules={[{ required: true, message: '请输入巡检命令' }]}
            extra="每行一个命令，切换设备类型会自动填充默认命令"
          >
            <TextArea
              rows={6}
              placeholder="display version&#10;display interface brief&#10;display vlan"
            />
          </Form.Item>

          <Form.Item name="devices" label="预设设备列表" extra="可选：预先配置设备，方便快速执行巡检">
            <TemplateDevicesEditor value={editingTemplate?.devices || []} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// 模板设备编辑器子组件
interface TemplateDevicesEditorProps {
  value?: InspectionDevice[];
  onChange?: (devices: InspectionDevice[]) => void;
}

function TemplateDevicesEditor({ value = [], onChange }: TemplateDevicesEditorProps) {
  const devices = value;
  const [modalVisible, setModalVisible] = useState(false);
  const [editingDevice, setEditingDevice] = useState<InspectionDevice | null>(null);
  const [form] = Form.useForm();
  const [testingHost, setTestingHost] = useState<string | null>(null);
  const [modalTesting, setModalTesting] = useState(false);

  const updateDevices = (newDevices: InspectionDevice[]) => {
    onChange?.(newDevices);
  };

  const handleAddDevice = () => {
    setEditingDevice(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEditDevice = (device: InspectionDevice) => {
    setEditingDevice(device);
    form.setFieldsValue(device);
    setModalVisible(true);
  };

  const handleDeleteDevice = (host: string) => {
    const newDevices = devices.filter(d => d.host !== host);
    updateDevices(newDevices);
  };

  const handleTestDevice = async (device: InspectionDevice) => {
    setTestingHost(device.host);
    try {
      const result = await testSSHConnection(device);
      if (result.success) {
        message.success(`设备 ${device.host} 连接成功 (延迟: ${result.latency}ms)`);
      } else {
        message.error(`设备 ${device.host} 连接失败: ${result.message}`);
      }
    } catch (err: any) {
      message.error(`测试失败: ${err.message}`);
    } finally {
      setTestingHost(null);
    }
  };

  const handleSaveDevice = async () => {
    try {
      const values = await form.validateFields();

      // 确保 port 是数字类型
      const deviceData: InspectionDevice = {
        host: values.host,
        port: values.port ? parseInt(String(values.port), 10) : 22,
        username: values.username,
        password: values.password || undefined,
        privateKey: values.privateKey || undefined,
        deviceType: values.deviceType || undefined,
      };

      let newDevices: InspectionDevice[];
      if (editingDevice) {
        newDevices = devices.map(d => d.host === editingDevice.host ? deviceData : d);
      } else {
        if (devices.some(d => d.host === values.host)) {
          message.warning('设备已存在');
          return;
        }
        newDevices = [...devices, deviceData];
      }

      updateDevices(newDevices);
      setModalVisible(false);
    } catch {
      // 表单验证失败
    }
  };

  const handleTestInModal = async () => {
    try {
      const values = await form.validateFields();
      setModalTesting(true);
      const result = await testSSHConnection(values);
      if (result.success) {
        message.success(`连接成功 (延迟: ${result.latency}ms)`);
      } else {
        message.error(`连接失败: ${result.message}`);
      }
    } catch (err: any) {
      message.error(`请先填写必填字段`);
    } finally {
      setModalTesting(false);
    }
  };

  return (
    <div>
      <Button type="dashed" block onClick={handleAddDevice} style={{ marginBottom: 8 }}>
        <PlusOutlined /> 添加设备
      </Button>

      {devices.length > 0 && (
        <div style={{ maxHeight: 200, overflow: 'auto' }}>
          {devices.map(device => (
            <Card key={device.host} size="small" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Text strong>{device.host}</Text>
                  <Text type="secondary" style={{ marginLeft: 8 }}>
                    :{device.port || 22}
                  </Text>
                  <Text type="secondary" style={{ marginLeft: 8 }}>
                    ({device.username})
                  </Text>
                </div>
                <Space>
                  <Button
                    size="small"
                    type="link"
                    onClick={() => handleTestDevice(device)}
                    loading={testingHost === device.host}
                  >
                    {testingHost === device.host ? '测试中...' : '测试'}
                  </Button>
                  <Button size="small" type="link" onClick={() => handleEditDevice(device)}>
                    编辑
                  </Button>
                  <Button size="small" type="link" danger onClick={() => handleDeleteDevice(device.host)}>
                    删除
                  </Button>
                </Space>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        title={editingDevice ? '编辑设备' : '添加设备'}
        open={modalVisible}
        onOk={handleSaveDevice}
        onCancel={() => setModalVisible(false)}
        width={400}
        footer={[
          <Button key="test" onClick={handleTestInModal} loading={modalTesting}>
            测试连接
          </Button>,
          <Button key="cancel" onClick={() => setModalVisible(false)}>
            取消
          </Button>,
          <Button key="save" type="primary" onClick={handleSaveDevice}>
            保存
          </Button>,
        ]}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="host"
            label="IP 地址"
            rules={[{ required: true, message: '请输入 IP 地址' }]}
          >
            <Input placeholder="192.168.1.1" disabled={!!editingDevice} />
          </Form.Item>
          <Form.Item
            name="port"
            label="SSH 端口"
            rules={[{ required: true, message: '请输入端口' }]}
          >
            <Input defaultValue={22} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="admin" />
          </Form.Item>
          <Form.Item name="password" label="密码">
            <Input.Password placeholder="留空则使用私钥认证" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default TemplateManagement;
