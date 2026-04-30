import { useState, useEffect } from 'react';
import { Table, Button, Space, Tag, Card, Typography, Modal, Form, Input, message, Upload, InputNumber, Divider, Descriptions, List, Collapse } from 'antd';
import { PlusOutlined, EyeOutlined, DeleteOutlined, ToolOutlined, UploadOutlined, LinkOutlined, FileTextOutlined, CodeOutlined, DownloadOutlined } from '@ant-design/icons';
import type { UploadProps, ColumnsType } from 'antd/es/table';
import { skillApi, Skill, CreateSkillInput } from '../../api/skill';

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;

function SkillList() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importType, setImportType] = useState<'file' | 'url'>('file');
  const [importUrl, setImportUrl] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [form] = Form.useForm();
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadSkills = async () => {
    setLoading(true);
    try {
      const res = await skillApi.list();
      const data = res.data || res || [];
      setSkills(Array.isArray(data) ? data : []);
    } catch (err) {
      message.error('加载 Skill 失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSkills();
  }, []);

  const parseJsonField = (val: string): any[] => {
    try {
      return JSON.parse(val || '[]');
    } catch {
      return [];
    }
  };

  const handleDelete = async (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个 Skill 吗？此操作不可撤销。',
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          await skillApi.delete(id);
          message.success('删除成功');
          loadSkills();
        } catch {
          message.error('删除失败');
        }
      },
    });
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      // 处理 tools 和 configurations 字段
      const submitData: CreateSkillInput = {
        ...values,
        tools: values.tools ? JSON.stringify(values.tools) : undefined,
        configurations: values.configurations ? JSON.stringify(values.configurations) : undefined,
      };
      await skillApi.create(submitData);
      message.success('创建成功');
      setCreateModalVisible(false);
      form.resetFields();
      loadSkills();
    } catch {
      message.error('创建失败');
    }
  };

  const handleViewDetail = async (id: string) => {
    setDetailModalVisible(true);
    setDetailLoading(true);
    try {
      const res = await skillApi.get(id);
      setDetailData(res.data || res);
    } catch {
      message.error('加载详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleImportFile: UploadProps['customRequest'] = async (options) => {
    const { file, onSuccess, onError } = options;
    const formData = new FormData();
    formData.append('file', file as File);

    try {
      const response = await fetch('/api/skills/import/file', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      if (result.success) {
        message.success('导入成功');
        setImportModalVisible(false);
        loadSkills();
        onSuccess?.(result);
      } else {
        message.error(result.error || '导入失败');
        onError?.(new Error(result.error));
      }
    } catch (err) {
      message.error('导入失败');
      onError?.(err as Error);
    }
  };

  const handleImportUrl = async () => {
    if (!importUrl.trim()) {
      message.warning('请输入 URL');
      return;
    }

    try {
      const response = await fetch(`/api/skills/import/url?url=${encodeURIComponent(importUrl)}`);
      const result = await response.json();
      if (result.success) {
        message.success('导入成功');
        setImportModalVisible(false);
        setImportUrl('');
        loadSkills();
      } else {
        message.error(result.error || '导入失败');
      }
    } catch {
      message.error('导入失败');
    }
  };

  const renderToolDefinition = (tools: any[]) => {
    if (!tools || tools.length === 0) return <Text type="secondary">暂无工具</Text>;

    return (
      <Collapse ghost>
        {tools.map((tool: any, index: number) => (
          <Panel
            key={index}
            header={
              <Space>
                <CodeOutlined />
                <Text strong>{tool.name || `Tool ${index + 1}`}</Text>
              </Space>
            }
          >
            <Paragraph>
              <Text type="secondary">描述：</Text>
              <br />
              {tool.description || '无'}
            </Paragraph>
            {tool.parameters && (
              <>
                <Text type="secondary">参数：</Text>
                <pre style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 12 }}>
                  {JSON.stringify(tool.parameters, null, 2)}
                </pre>
              </>
            )}
          </Panel>
        ))}
      </Collapse>
    );
  };

  const columns: ColumnsType<Skill> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <Space>
          <ToolOutlined />
          <strong>{text}</strong>
          <Tag color="blue">{record.version}</Tag>
        </Space>
      ),
    },
    {
      title: '作者',
      dataIndex: 'author',
      key: 'author',
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '标签',
      key: 'tags',
      render: (_, record) => {
        const tags = parseJsonField(record.tags);
        return tags.length > 0 ? tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Text type="secondary">-</Text>;
      },
    },
    {
      title: '工具数',
      key: 'toolsCount',
      render: (_, record) => {
        const tools = parseJsonField(record.tools);
        return <Tag color="green">{tools.length}</Tag>;
      },
    },
    {
      title: '类型',
      dataIndex: 'builtIn',
      key: 'builtIn',
      render: (builtIn) => (
        <Tag color={builtIn ? 'gold' : 'default'}>
          {builtIn ? '内置' : '自定义'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space>
          <Button type="link" icon={<EyeOutlined />} size="small" onClick={() => handleViewDetail(record.id)}>
            详情
          </Button>
          {!record.builtIn && (
            <Button type="link" danger icon={<DeleteOutlined />} size="small" onClick={() => handleDelete(record.id)}>
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={3}>Skill 管理</Title>
        <Space>
          <Button icon={<UploadOutlined />} onClick={() => { setImportType('file'); setImportModalVisible(true); }}>
            导入
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>
            新建 Skill
          </Button>
        </Space>
      </div>

      <Card style={{ marginTop: 16 }}>
        <Table
          columns={columns}
          dataSource={skills}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* 新建 Skill Modal */}
      <Modal title="新建 Skill" open={createModalVisible} onOk={handleSubmit} onCancel={() => { setCreateModalVisible(false); form.resetFields(); }} width={700}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="skill-name" />
          </Form.Item>
          <Form.Item name="version" label="版本" rules={[{ required: true, message: '请输入版本' }]}>
            <Input placeholder="1.0.0" />
          </Form.Item>
          <Form.Item name="author" label="作者" rules={[{ required: true, message: '请输入作者' }]}>
            <Input placeholder="作者名称" />
          </Form.Item>
          <Form.Item name="description" label="描述" rules={[{ required: true, message: '请输入描述' }]}>
            <Input.TextArea rows={2} placeholder="Skill 功能描述" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 导入 Modal */}
      <Modal
        title="导入 Skill"
        open={importModalVisible}
        onCancel={() => { setImportModalVisible(false); setImportUrl(''); }}
        footer={null}
        width={500}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Space>
            <Button
              type={importType === 'file' ? 'primary' : 'default'}
              icon={<UploadOutlined />}
              onClick={() => setImportType('file')}
            >
              本地文件
            </Button>
            <Button
              type={importType === 'url' ? 'primary' : 'default'}
              icon={<LinkOutlined />}
              onClick={() => setImportType('url')}
            >
              URL
            </Button>
          </Space>

          {importType === 'file' ? (
            <Upload.Dragger
              accept=".json"
              customRequest={handleImportFile}
              showUploadList={false}
              beforeUpload={(file) => {
                const isJson = file.type === 'application/json' || file.name.endsWith('.json');
                if (!isJson) {
                  message.error('只能上传 JSON 文件');
                }
                return isJson;
              }}
            >
              <p className="ant-upload-drag-icon">
                <FileTextOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽 JSON 文件到此处上传</p>
              <p className="ant-upload-hint">支持 .json 格式的 Skill 定义文件</p>
            </Upload.Dragger>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input
                placeholder="输入 Skill JSON 的 URL 地址"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                prefix={<LinkOutlined />}
              />
              <Button type="primary" block onClick={handleImportUrl} icon={<DownloadOutlined />}>
                导入
              </Button>
            </Space>
          )}
        </Space>
      </Modal>

      {/* 详情 Modal */}
      <Modal
        title={
          <Space>
            <ToolOutlined />
            <span>{detailData?.name || 'Skill 详情'}</span>
            {detailData && <Tag color="blue">{detailData.version}</Tag>}
          </Space>
        }
        open={detailModalVisible}
        onCancel={() => { setDetailModalVisible(false); setDetailData(null); }}
        footer={[
          <Button key="close" onClick={() => setDetailModalVisible(false)}>
            关闭
          </Button>,
        ]}
        width={700}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>加载中...</div>
        ) : detailData ? (
          <div>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="名称" span={2}>
                <Text strong>{detailData.name}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="版本">{detailData.version}</Descriptions.Item>
              <Descriptions.Item label="作者">{detailData.author}</Descriptions.Item>
              <Descriptions.Item label="类型">
                <Tag color={detailData.builtIn ? 'gold' : 'default'}>
                  {detailData.builtIn ? '内置' : '自定义'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="关联 Agent">
                {detailData.agentSkills?.length || 0} 个
              </Descriptions.Item>
              <Descriptions.Item label="描述" span={2}>
                {detailData.description}
              </Descriptions.Item>
              <Descriptions.Item label="标签" span={2}>
                {(() => {
                  const tags = parseJsonField(detailData.tags);
                  return tags.length > 0 ? tags.map((tag: string) => <Tag key={tag}>{tag}</Tag>) : '-';
                })()}
              </Descriptions.Item>
            </Descriptions>

            <Divider>工具定义</Divider>
            {renderToolDefinition(parseJsonField(detailData.tools))}

            {parseJsonField(detailData.configurations).length > 0 && (
              <>
                <Divider>配置项</Divider>
                <Descriptions column={1} bordered size="small">
                  {parseJsonField(detailData.configurations).map((config: any, index: number) => (
                    <Descriptions.Item key={index} label={config.key}>
                      <Space direction="vertical" size={0}>
                        <Text>{config.description}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          类型: {config.type} | 默认值: {config.default ?? '-'}
                        </Text>
                      </Space>
                    </Descriptions.Item>
                  ))}
                </Descriptions>
              </>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
        )}
      </Modal>
    </div>
  );
}

export default SkillList;
