/**
 * 巡检报告详情弹窗 (OP40)
 * 展示 MD 报告 + Agent 分析结果
 */

import { useEffect, useState } from 'react';
import {
  Modal,
  Tabs,
  Card,
  Tag,
  Typography,
  Space,
  Spin,
  Button,
  message,
} from 'antd';
import {
  FileTextOutlined,
  RobotOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  getInspectionRecord,
  getBaseline,
  regenerateBaseline,
  InspectionRecordDetail,
} from '../../api/inspection';
import ReactMarkdown from 'react-markdown';

const { Title, Text } = Typography;

interface ReportDetailModalProps {
  recordId?: string;
  record?: InspectionRecordDetail | null;
  visible: boolean;
  onClose: () => void;
}

function ReportDetailModal({ recordId, record: propRecord, visible, onClose }: ReportDetailModalProps) {
  const [record, setRecord] = useState<InspectionRecordDetail | null>(propRecord || null);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (visible && recordId && !propRecord) {
      loadRecord();
    } else if (propRecord) {
      setRecord(propRecord);
    }
  }, [visible, recordId, propRecord]);

  const loadRecord = async () => {
    if (!recordId) return;
    
    setLoading(true);
    try {
      const data = await getInspectionRecord(recordId);
      setRecord(data);
    } catch {
      message.error('加载报告详情失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateBaseline = async () => {
    if (!record?.template?.id) {
      message.warning('该巡检没有关联模板，无法重新生成基线');
      return;
    }

    setRegenerating(true);
    try {
      await regenerateBaseline(record.template.id, record.agent?.id);
      message.success('基线已重新生成');
      loadRecord();
    } catch (err: any) {
      message.error(err.message || '重新生成基线失败');
    } finally {
      setRegenerating(false);
    }
  };

  const renderReportContent = () => {
    if (!record?.reportContent) {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Text type="secondary">暂无报告内容</Text>
        </div>
      );
    }

    return (
      <div style={{ padding: 16 }}>
        <ReactMarkdown>{record.reportContent}</ReactMarkdown>
      </div>
    );
  };

  const renderAnalysisContent = () => {
    const summary = record?.summary;
    const agentAnalysis = summary?.agentAnalysis;

    return (
      <div style={{ padding: 16 }}>
        {summary?.baselineGenerated && (
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space>
              <Tag icon={<CheckCircleOutlined />} color="blue">
                基线已生成
              </Tag>
              <Text type="secondary">版本 v{summary.baselineVersion}</Text>
            </Space>
          </Card>
        )}

        {summary?.baselineAnalyzed && (
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space>
              <Tag icon={<CheckCircleOutlined />} color="green">
                已进行偏差分析
              </Tag>
            </Space>
          </Card>
        )}

        {agentAnalysis ? (
          <Card
            title={
              <Space>
                <RobotOutlined />
                <span>Agent 分析结果</span>
              </Space>
            }
          >
            <ReactMarkdown>{agentAnalysis}</ReactMarkdown>
          </Card>
        ) : (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Text type="secondary">暂无 Agent 分析结果</Text>
          </div>
        )}

        {record?.template?.id && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRegenerateBaseline}
              loading={regenerating}
            >
              重新生成基线
            </Button>
          </div>
        )}
      </div>
    );
  };

  const renderBaselineContent = async () => {
    if (!record?.template?.id) {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Text type="secondary">该巡检没有关联模板</Text>
        </div>
      );
    }

    try {
      const baselineData = await getBaseline(record.template.id);

      if (!baselineData.hasBaseline) {
        return (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Text type="secondary">该模板暂无基线文档</Text>
            <div style={{ marginTop: 16 }}>
              <Button type="primary" onClick={handleRegenerateBaseline} loading={regenerating}>
                基于本次巡检生成基线
              </Button>
            </div>
          </div>
        );
      }

      return (
        <div style={{ padding: 16 }}>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space>
              <Tag color="blue">版本 v{baselineData.baseline?.version}</Tag>
              <Text type="secondary">
                生成时间：{new Date(baselineData.baseline?.generatedAt || '').toLocaleString('zh-CN')}
              </Text>
            </Space>
          </Card>
          {baselineData.baseline?.content && (
            <ReactMarkdown>{baselineData.baseline.content}</ReactMarkdown>
          )}
        </div>
      );
    } catch {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Text type="secondary">加载基线文档失败</Text>
        </div>
      );
    }
  };

  if (loading) {
    return (
      <Modal
        title="巡检报告详情"
        open={visible}
        onCancel={onClose}
        footer={null}
        width={900}
      >
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">加载中...</Text>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={
        <Space>
          <FileTextOutlined />
          <span>巡检报告详情</span>
          {record && (
            <Tag
              icon={record.status === 'success' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
              color={record.status === 'success' ? 'success' : 'error'}
            >
              {record.status === 'success' ? '成功' : record.status === 'failed' ? '失败' : '进行中'}
            </Tag>
          )}
        </Space>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={900}
      style={{ top: 20 }}
    >
      {record && (
        <>
          <div style={{ marginBottom: 16 }}>
            <Space>
              {record.template && (
                <Tag color="blue">{record.template.name}</Tag>
              )}
              {record.agent && (
                <Tag>{record.agent.name}</Tag>
              )}
              <Text type="secondary">
                {new Date(record.startTime).toLocaleString('zh-CN')}
              </Text>
            </Space>
          </div>

          <Tabs
            items={[
              {
                key: 'report',
                label: (
                  <span>
                    <FileTextOutlined />
                    巡检报告
                  </span>
                ),
                children: renderReportContent(),
              },
              {
                key: 'analysis',
                label: (
                  <span>
                    <RobotOutlined />
                    Agent 分析
                  </span>
                ),
                children: renderAnalysisContent(),
              },
              {
                key: 'baseline',
                label: (
                  <span>
                    基线文档
                  </span>
                ),
                children: renderBaselineContent(),
              },
            ]}
          />
        </>
      )}
    </Modal>
  );
}

export default ReportDetailModal;
