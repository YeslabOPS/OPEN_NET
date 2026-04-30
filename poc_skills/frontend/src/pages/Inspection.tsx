import { useState, useEffect } from 'react';
import { Card, Table, Tag, Button, Space, Typography, Alert, Spin, Collapse, Modal, Form, Input, Select, InputNumber, message, Progress, Statistic, Row, Col, Divider } from 'antd';
import { PlayCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, ThunderboltOutlined, PlusOutlined, DeleteOutlined, FileTextOutlined, SettingOutlined } from '@ant-design/icons';
import { agentApi } from '../api/agent';
import { Agent } from '../api/agent';
import apiClient from '../api';

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;
const { TextArea } = Input;

interface Device {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  deviceType?: 'switch' | 'router' | 'firewall' | 'generic';
  customCommands?: string[];
}

interface InspectionResult {
  device: string;
  deviceType: string;
  success: boolean;
  error?: string;
  commands: {
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    duration: number;
  }[];
  timestamp: string;
}

interface Summary {
  total: number;
  success: number;
  failed: number;
}

function Inspection() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [devices, setDevices] = useState<Device[]>([]);
  const [results, setResults] = useState<InspectionResult[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, success: 0, failed: 0 });
  const [loading, setLoading] = useState(false);
  const [agentLoading, setAgentLoading] = useState(true);
  const [deviceModalVisible, setDeviceModalVisible] = useState(false);
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [deviceForm] = Form.useForm();
  const [selectedResult, setSelectedResult] = useState<InspectionResult | null>(null);

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    setAgentLoading(true);
    try {
      const data = await agentApi.list();
      const agentList = Array.isArray(data) ? data : [];
      setAgents(agentList);
      if (agentList.length > 0) {
        setSelectedAgentId(agentList[0].id);
      }
    } catch {
      message.error('加载 Agent 列表失败');
    } finally {
      setAgentLoading(false);
    }
  };

  const handleStartInspection = async () => {
    if (!selectedAgentId) {
      message.warning('请选择 Agent');
      return;
    }

    if (devices.length === 0) {
      message.warning('请添加巡检设备');
      return;
    }

    setLoading(true);
    setResults([]);

    try {
      const response = await apiClient.post('/inspection', {
        agentId: selectedAgentId,
        devices,
        concurrency: 3,
      });

      if (response.data?.success) {
        setResults(response.data.data.results);
        setSummary(response.data.data.summary);
        message.success('巡检完成');
      } else {
        throw new Error(response.data?.error || '巡检失败');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message || '巡检失败');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickInspection = async () => {
    if (!selectedAgentId) {
      message.warning('请选择 Agent');
      return;
    }

    Modal.confirm({
      title: '快速巡检',
      content: '将使用设置中配置的设备列表执行巡检。是否继续？',
      onOk: async () => {
        setLoading(true);
        setResults([]);

        try {
          const response = await apiClient.post('/inspection/quick', {
            agentId: selectedAgentId,
          });

          if (response.data?.success) {
            setResults(response.data.data.results);
            setSummary(response.data.data.summary);
            message.success('巡检完成');
          } else {
            throw new Error(response.data?.error || '巡检失败');
          }
        } catch (err: any) {
          message.error(err.response?.data?.error || err.message || '巡检失败');
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const handleAddDevice = () => {
    setEditingDevice(null);
    deviceForm.resetFields();
    setDeviceModalVisible(true);
  };

  const handleEditDevice = (device: Device) => {
    setEditingDevice(device);
    deviceForm.setFieldsValue(device);
    setDeviceModalVisible(true);
  };

  const handleDeleteDevice = (host: string) => {
    setDevices(prev => prev.filter(d => d.host !== host));
  };

  const handleSaveDevice = async () => {
    try {
      const values = await deviceForm.validateFields();
      
      if (editingDevice) {
        setDevices(prev => prev.map(d => d.host === editingDevice.host ? { ...values } : d));
      } else {
        if (devices.some(d => d.host === values.host)) {
          message.warning('设备已存在');
          return;
        }
        setDevices(prev => [...prev, { ...values }]);
      }
      
      setDeviceModalVisible(false);
      message.success(editingDevice ? '修改成功' : '添加成功');
    } catch {
      // 表单验证失败
    }
  };

  const handleImportDevices = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const importedDevices = JSON.parse(text);
        
        if (!Array.isArray(importedDevices)) {
          throw new Error('Invalid format');
        }

        const newDevices = importedDevices.filter(
          (d: any) => d.host && d.username && !devices.some(existing => existing.host === d.host)
        );

        if (newDevices.length > 0) {
          setDevices(prev => [...prev, ...newDevices]);
          message.success(`成功导入 ${newDevices.length} 个设备`);
        } else {
          message.warning('没有新设备需要导入');
        }
      } catch {
        message.error('导入失败，请检查文件格式');
      }
    };
    input.click();
  };

  const deviceColumns = [
    {
      title: 'IP 地址',
      dataIndex: 'host',
      key: 'host',
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: '端口',
      dataIndex: 'port',
      key: 'port',
      render: (port?: number) => port || 22,
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '设备类型',
      dataIndex: 'deviceType',
      key: 'deviceType',
      render: (type?: string) => {
        const colors: Record<string, string> = {
          switch: 'blue',
          router: 'green',
          firewall: 'orange',
          generic: 'default',
        };
        return <Tag color={colors[type || 'generic']}>{type || 'generic'}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Device) => (
        <Space>
          <Button type="link" size="small" onClick={() => handleEditDevice(record)}>
            编辑
          </Button>
          <Button type="link" danger size="small" onClick={() => handleDeleteDevice(record.host)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const resultColumns = [
    {
      title: '设备',
      dataIndex: 'device',
      key: 'device',
      render: (text: string, record: InspectionResult) => (
        <Space direction="vertical" size={0}>
          <Text strong>{text}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {record.deviceType}
          </Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'success',
      key: 'success',
      render: (success: boolean, record: InspectionResult) => (
        success ? (
          <Tag icon={<CheckCircleOutlined />} color="success">成功</Tag>
        ) : (
          <Tag icon={<CloseCircleOutlined />} color="error">
            失败 {record.error ? `- ${record.error}` : ''}
          </Tag>
        )
      ),
    },
    {
      title: '命令数',
      key: 'commandsCount',
      render: (_: any, record: InspectionResult) => {
        const successCount = record.commands.filter(c => c.exitCode === 0).length;
        return (
          <Tag color={successCount === record.commands.length ? 'success' : 'warning'}>
            {successCount}/{record.commands.length}
          </Tag>
        );
      },
    },
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      render: (timestamp: string) => new Date(timestamp).toLocaleTimeString(),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: InspectionResult) => (
        <Button type="link" size="small" onClick={() => setSelectedResult(record)}>
          查看详情
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          <ThunderboltOutlined /> 批量巡检
        </Title>
        <Space>
          <Select
            value={selectedAgentId}
            onChange={setSelectedAgentId}
            style={{ width: 200 }}
            loading={agentLoading}
            placeholder="选择 Agent"
            options={agents.map(a => ({ value: a.id, label: a.name }))}
          />
          <Button icon={<SettingOutlined />} onClick={() => setConfigModalVisible(true)}>
            配置
          </Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="设备总数"
              value={devices.length}
              prefix={<ThunderboltOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="巡检成功"
              value={summary.success}
              valueStyle={{ color: '#3f8600' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="巡检失败"
              value={summary.failed}
              valueStyle={{ color: '#cf1322' }}
              prefix={<CloseCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="成功率"
              value={summary.total > 0 ? Math.round((summary.success / summary.total) * 100) : 0}
              suffix="%"
              valueStyle={{ color: summary.total > 0 && summary.success === summary.total ? '#3f8600' : '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      {loading && (
        <Alert
          message="巡检进行中..."
          description={<Progress percent={50} status="active" />}
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Card
        title="巡检设备列表"
        extra={
          <Space>
            <Button icon={<FileTextOutlined />} onClick={handleImportDevices}>
              导入
            </Button>
            <Button icon={<PlusOutlined />} onClick={handleAddDevice}>
              添加
            </Button>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleStartInspection}
              loading={loading}
              disabled={devices.length === 0}
            >
              开始巡检
            </Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Table
          columns={deviceColumns}
          dataSource={devices}
          rowKey="host"
          pagination={false}
          size="small"
        />
      </Card>

      {results.length > 0 && (
        <Card title="巡检结果">
          <Table
            columns={resultColumns}
            dataSource={results}
            rowKey="device"
            pagination={false}
          />
        </Card>
      )}

      {/* 添加/编辑设备 Modal */}
      <Modal
        title={editingDevice ? '编辑设备' : '添加设备'}
        open={deviceModalVisible}
        onOk={handleSaveDevice}
        onCancel={() => setDeviceModalVisible(false)}
        width={500}
      >
        <Form form={deviceForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="host" label="IP 地址" rules={[{ required: true, message: '请输入 IP 地址' }]}>
            <Input placeholder="192.168.1.1" disabled={!!editingDevice} />
          </Form.Item>
          <Form.Item name="port" label="SSH 端口" rules={[{ required: true, message: '请输入端口' }]}>
            <InputNumber min={1} max={65535} defaultValue={22} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="admin" />
          </Form.Item>
          <Form.Item name="password" label="密码">
            <Input.Password placeholder="留空则使用私钥认证" />
          </Form.Item>
          <Form.Item name="deviceType" label="设备类型">
            <Select
              placeholder="选择设备类型"
              options={[
                { value: 'switch', label: '交换机 (Switch)' },
                { value: 'router', label: '路由器 (Router)' },
                { value: 'firewall', label: '防火墙 (Firewall)' },
                { value: 'generic', label: '通用设备' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 巡检结果详情 Modal */}
      <Modal
        title={
          <Space>
            <FileTextOutlined />
            巡检详情 - {selectedResult?.device}
          </Space>
        }
        open={!!selectedResult}
        onCancel={() => setSelectedResult(null)}
        footer={null}
        width={800}
      >
        {selectedResult && (
          <div>
            <Space style={{ marginBottom: 16 }}>
              <Tag color={selectedResult.success ? 'success' : 'error'} icon={selectedResult.success ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>
                {selectedResult.success ? '成功' : '失败'}
              </Tag>
              <Tag>{selectedResult.deviceType}</Tag>
              <Text type="secondary">{new Date(selectedResult.timestamp).toLocaleString()}</Text>
            </Space>

            <Collapse>
              {selectedResult.commands.map((cmd, index) => (
                <Panel
                  key={index}
                  header={
                    <Space>
                      <Text code>{cmd.command}</Text>
                      <Tag color={cmd.exitCode === 0 ? 'success' : 'error'}>
                        {cmd.exitCode === 0 ? '成功' : '失败'}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {cmd.duration}ms
                      </Text>
                    </Space>
                  }
                >
                  <Paragraph>
                    <pre style={{
                      backgroundColor: '#f5f5f5',
                      padding: 12,
                      borderRadius: 4,
                      maxHeight: 300,
                      overflow: 'auto',
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}>
                      {cmd.stdout || cmd.stderr || '无输出'}
                    </pre>
                  </Paragraph>
                </Panel>
              ))}
            </Collapse>
          </div>
        )}
      </Modal>

      {/* 配置 Modal */}
      <Modal
        title="巡检配置"
        open={configModalVisible}
        onCancel={() => setConfigModalVisible(false)}
        footer={null}
        width={600}
      >
        <Divider>巡检设备列表配置</Divider>
        <Paragraph type="secondary">
          在此处配置巡检设备列表，可用于「快速巡检」功能。配置格式为 JSON 数组。
        </Paragraph>
        <Form layout="vertical">
          <Form.Item label="设备列表配置 (JSON)">
            <TextArea
              rows={10}
              placeholder={JSON.stringify([
                {
                  host: "192.168.1.1",
                  port: 22,
                  username: "admin",
                  password: "password",
                  deviceType: "switch"
                }
              ], null, 2)}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Form.Item>
        </Form>
        <Button type="primary" block onClick={() => setConfigModalVisible(false)}>
          保存配置
        </Button>
      </Modal>
    </div>
  );
}

export default Inspection;
