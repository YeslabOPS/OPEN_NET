/**
 * 即时巡检 Tab (OP35)
 * 支持选择模板快速加载设备列表
 */

import { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Tag,
  Button,
  Space,
  Typography,
  Alert,
  Progress,
  Statistic,
  Row,
  Col,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  message,
  Divider,
} from 'antd';
import {
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { agentApi } from '../../api/agent';
import { Agent } from '../../api/agent';
import {
  getTemplates,
  runInspection,
  InspectionTemplate,
  InspectionDevice,
  InspectionRecordDetail,
} from '../../api/inspection';
import ReportDetailModal from './ReportDetailModal';

const { Title, Text } = Typography;
const { TextArea } = Input;

interface ResultDevice {
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

function InspectionNow() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [devices, setDevices] = useState<InspectionDevice[]>([]);
  const [results, setResults] = useState<ResultDevice[]>([]);
  const [summary, setSummary] = useState<{
    totalDevices: number;
    successDevices: number;
    failedDevices: number;
  }>({ totalDevices: 0, successDevices: 0, failedDevices: 0 });
  const [loading, setLoading] = useState(false);
  const [agentLoading, setAgentLoading] = useState(true);
  const [deviceModalVisible, setDeviceModalVisible] = useState(false);
  const [editingDevice, setEditingDevice] = useState<InspectionDevice | null>(null);
  const [deviceForm] = Form.useForm();
  const [selectedResult, setSelectedResult] = useState<ResultDevice | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [currentRecordId, setCurrentRecordId] = useState<string | null>(null);

  useEffect(() => {
    loadAgents();
    loadTemplates();
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

  const loadTemplates = async () => {
    try {
      const data = await getTemplates();
      console.log('[InspectionNow] loadTemplates data:', data);
      setTemplates(Array.isArray(data) ? data : []);
    } catch {
      message.error('加载模板列表失败');
    }
  };

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates.find(t => t.id === templateId);
    if (template && template.devices.length > 0) {
      setDevices(template.devices);
      message.success(`已加载模板「${template.name}」的 ${template.devices.length} 个设备`);
    } else {
      message.info('该模板未配置设备，请手动添加');
      setDevices([]);
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
      const response = await runInspection({
        agentId: selectedAgentId,
        templateId: selectedTemplateId || undefined,
        devices,
        concurrency: 3,
      });

      setResults(response.results || []);
      setSummary({
        totalDevices: response.summary.totalDevices,
        successDevices: response.summary.successDevices,
        failedDevices: response.summary.failedDevices,
      });
      setCurrentRecordId(response.recordId);
      message.success('巡检完成');

      // 刷新模板列表（可能生成了基线）
      loadTemplates();
    } catch (err: any) {
      message.error(err.message || '巡检失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAddDevice = () => {
    setEditingDevice(null);
    deviceForm.resetFields();
    setDeviceModalVisible(true);
  };

  const handleEditDevice = (device: InspectionDevice) => {
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
        const importedDevices = JSON.parse(text) as InspectionDevice[];

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
      render: (_: any, record: InspectionDevice) => (
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
      render: (text: string, record: ResultDevice) => (
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
      render: (success: boolean, record: ResultDevice) =>
        success ? (
          <Tag icon={<CheckCircleOutlined />} color="success">成功</Tag>
        ) : (
          <Tag icon={<CloseCircleOutlined />} color="error">
            失败 {record.error ? `- ${record.error}` : ''}
          </Tag>
        ),
    },
    {
      title: '命令数',
      key: 'commandsCount',
      render: (_: any, record: ResultDevice) => {
        const successCount = record.commands.filter(c => c.exitCode === 0).length;
        return (
          <Tag color={successCount === record.commands.length ? 'success' : 'warning'}>
            {successCount}/{record.commands.length}
          </Tag>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: ResultDevice) => (
        <Button type="link" size="small" onClick={() => setSelectedResult(record)}>
          查看详情
        </Button>
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
          <ThunderboltOutlined /> 即时巡检
        </Title>
        <Space>
          <Select
            value={selectedTemplateId || undefined}
            onChange={handleSelectTemplate}
            style={{ width: 200 }}
            placeholder="选择模板加载设备"
            allowClear
            options={templates.map(t => ({
              value: t.id,
              label: `${t.name} (${t.devices?.length || 0}台)`,
            }))}
            dropdownStyle={{ minWidth: 200 }}
          />
          <span style={{ marginLeft: 8, color: '#999' }}>模板数: {templates.length}</span>
          <Select
            value={selectedAgentId}
            onChange={setSelectedAgentId}
            style={{ width: 160 }}
            loading={agentLoading}
            placeholder="选择 Agent"
            options={agents.map(a => ({ value: a.id, label: a.name }))}
          />
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="设备总数"
              value={devices.length}
              prefix={<ThunderboltOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="巡检成功"
              value={summary.successDevices}
              valueStyle={{ color: '#3f8600' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="巡检失败"
              value={summary.failedDevices}
              valueStyle={{ color: '#cf1322' }}
              prefix={<CloseCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="成功率"
              value={
                summary.totalDevices > 0
                  ? Math.round((summary.successDevices / summary.totalDevices) * 100)
                  : 0
              }
              suffix="%"
              valueStyle={{
                color:
                  summary.totalDevices > 0 && summary.successDevices === summary.totalDevices
                    ? '#3f8600'
                    : '#faad14',
              }}
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
            <Button icon={<UploadOutlined />} onClick={handleImportDevices}>
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
            {currentRecordId && (
              <Button onClick={() => setReportModalVisible(true)}>
                查看完整报告
              </Button>
            )}
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
          locale={{ emptyText: '请添加巡检设备或选择模板加载' }}
        />
      </Card>

      {results.length > 0 && (
        <Card title="巡检结果" style={{ marginBottom: 16 }}>
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
            <InputNumber min={1} max={65535} defaultValue={22} style={{ width: '100%' }} />
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
              <Tag
                color={selectedResult.success ? 'success' : 'error'}
                icon={selectedResult.success ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
              >
                {selectedResult.success ? '成功' : '失败'}
              </Tag>
              <Tag>{selectedResult.deviceType}</Tag>
            </Space>

            {selectedResult.commands.map((cmd, index) => (
              <Card key={index} size="small" style={{ marginBottom: 8 }}>
                <Space>
                  <Text code>{cmd.command}</Text>
                  <Tag color={cmd.exitCode === 0 ? 'success' : 'error'}>
                    {cmd.exitCode === 0 ? '成功' : '失败'}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {cmd.duration}ms
                  </Text>
                </Space>
                <TextArea
                  value={cmd.stdout || cmd.stderr || '无输出'}
                  readOnly
                  autoSize={{ minRows: 3, maxRows: 10 }}
                  style={{
                    marginTop: 8,
                    fontFamily: 'monospace',
                    fontSize: 12,
                  }}
                />
              </Card>
            ))}
          </div>
        )}
      </Modal>

      {/* 完整报告 Modal */}
      <ReportDetailModal
        recordId={currentRecordId}
        visible={reportModalVisible}
        onClose={() => setReportModalVisible(false)}
      />
    </div>
  );
}

export default InspectionNow;
