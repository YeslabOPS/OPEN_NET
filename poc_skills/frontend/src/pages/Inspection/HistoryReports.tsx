/**
 * 历史报告 Tab (OP37)
 * 记录表格，状态/时间筛选，查看报告详情
 */

import { useState, useEffect } from 'react';
import {
  Table,
  Card,
  Button,
  Space,
  Typography,
  Tag,
  Select,
  DatePicker,
  message,
  Tooltip,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  FileTextOutlined,
  DiffOutlined,
} from '@ant-design/icons';
import {
  getInspectionRecords,
  getInspectionRecord,
  getTemplates,
  InspectionRecord,
  InspectionRecordDetail,
  InspectionTemplate,
} from '../../api/inspection';
import ReportDetailModal from './ReportDetailModal';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

function HistoryReports() {
  const [records, setRecords] = useState<InspectionRecord[]>([]);
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0,
  });
  const [filters, setFilters] = useState<{
    status?: string;
    templateId?: string;
  }>({});
  const [selectedRecord, setSelectedRecord] = useState<InspectionRecordDetail | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    loadRecords();
  }, [pagination.current, pagination.pageSize, filters]);

  const loadTemplates = async () => {
    try {
      const data = await getTemplates();
      setTemplates(data || []);
    } catch {
      message.error('加载模板列表失败');
    }
  };

  const loadRecords = async () => {
    setLoading(true);
    try {
      const data = await getInspectionRecords({
        page: pagination.current,
        pageSize: pagination.pageSize,
        status: filters.status,
        templateId: filters.templateId,
      });

      setRecords(data.records || []);
      setPagination(prev => ({
        ...prev,
        total: data.pagination.total,
      }));
    } catch {
      message.error('加载巡检记录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetail = async (recordId: string) => {
    try {
      const detail = await getInspectionRecord(recordId);
      setSelectedRecord(detail);
      setReportModalVisible(true);
    } catch {
      message.error('加载报告详情失败');
    }
  };

  const handleTableChange = (paginationConfig: any, filtersConfig: any) => {
    setPagination({
      current: paginationConfig.current,
      pageSize: paginationConfig.pageSize,
      total: pagination.total,
    });
  };

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'running':
        return <Tag icon={<LoadingOutlined />} color="processing">进行中</Tag>;
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
      title: '开始时间',
      dataIndex: 'startTime',
      key: 'startTime',
      width: 180,
      render: (time: string) => new Date(time).toLocaleString('zh-CN'),
    },
    {
      title: '模板',
      dataIndex: ['template', 'name'],
      key: 'template',
      render: (name: string, record: InspectionRecord) => (
        <Space direction="vertical" size={0}>
          <Text>{name || '临时巡检'}</Text>
          {record.template?.deviceType && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {record.template.deviceType}
            </Text>
          )}
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
      title: '设备数',
      dataIndex: 'devicesCount',
      key: 'devicesCount',
      width: 80,
      render: (count: number) => count || 0,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: getStatusTag,
    },
    {
      title: '执行结果',
      key: 'summary',
      width: 200,
      render: (_: any, record: InspectionRecord) => {
        if (!record.summary || record.status === 'running') {
          return <Text type="secondary">-</Text>;
        }

        const { totalDevices, successDevices, failedDevices } = record.summary;
        return (
          <Space direction="vertical" size={2}>
            <Text>
              成功 <Text strong style={{ color: '#3f8600' }}>{successDevices}</Text> /{' '}
              失败 <Text strong style={{ color: '#cf1322' }}>{failedDevices}</Text>
            </Text>
            {record.summary.duration && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                耗时 {Math.round(record.summary.duration / 1000)}s
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: '基线',
      key: 'baseline',
      width: 120,
      render: (_: any, record: InspectionRecord) => {
        if (record.summary?.baselineGenerated) {
          return <Tag icon={<DiffOutlined />} color="blue">已生成 v{record.summary.baselineVersion}</Tag>;
        }
        if (record.summary?.baselineAnalyzed) {
          return <Tag icon={<DiffOutlined />} color="green">已对比</Tag>;
        }
        return <Text type="secondary">-</Text>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: InspectionRecord) => (
        <Button
          type="link"
          icon={<FileTextOutlined />}
          onClick={() => handleViewDetail(record.id)}
          disabled={record.status === 'running'}
        >
          查看报告
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
          历史报告
        </Title>
        <Space>
          <Select
            placeholder="筛选模板"
            allowClear
            style={{ width: 180 }}
            onChange={value => {
              setFilters(prev => ({ ...prev, templateId: value }));
              setPagination(prev => ({ ...prev, current: 1 }));
            }}
            options={templates.map(t => ({ value: t.id, label: t.name }))}
          />
          <Select
            placeholder="筛选状态"
            allowClear
            style={{ width: 120 }}
            onChange={value => {
              setFilters(prev => ({ ...prev, status: value }));
              setPagination(prev => ({ ...prev, current: 1 }));
            }}
            options={[
              { value: 'running', label: '进行中' },
              { value: 'success', label: '成功' },
              { value: 'failed', label: '失败' },
            ]}
          />
          <Button onClick={loadRecords}>刷新</Button>
        </Space>
      </div>

      <Card bodyStyle={{ padding: 0 }}>
        <Table
          columns={columns}
          dataSource={records}
          rowKey="id"
          loading={loading}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: total => `共 ${total} 条记录`,
          }}
          onChange={handleTableChange}
          size="middle"
        />
      </Card>

      <ReportDetailModal
        record={selectedRecord}
        visible={reportModalVisible}
        onClose={() => {
          setReportModalVisible(false);
          setSelectedRecord(null);
        }}
      />
    </div>
  );
}

export default HistoryReports;
