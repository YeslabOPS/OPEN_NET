/**
 * 通知中心页面 (OP43)
 * 表格展示所有通知，支持按类型和已读状态筛选
 */

import { useState, useEffect, useCallback } from 'react';
import { Table, Button, Tag, Space, Typography, Card, Select, Popconfirm, message } from 'antd';
import { CheckOutlined, DeleteOutlined, ReloadOutlined, FileTextOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification, type Notification } from '../api/notification';
import { regenerateBaseline } from '../api/inspection';

const { Title, Text } = Typography;

const notificationTypeMap: Record<string, { color: string; label: string }> = {
  inspection: { color: 'blue', label: '巡检' },
  report: { color: 'green', label: '报告' },
  baseline: { color: 'orange', label: '基线' },
  system: { color: 'default', label: '系统' },
};

const statusTypeMap = {
  running: { color: 'processing', label: '进行中' },
  success: { color: 'success', label: '成功' },
  failed: { color: 'error', label: '失败' },
};

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Notifications() {
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0,
  });
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [isReadFilter, setIsReadFilter] = useState<boolean | undefined>(undefined);
  const navigate = useNavigate();

  // 加载通知列表
  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getNotifications({
        page: pagination.current,
        pageSize: pagination.pageSize,
        type: typeFilter,
        isRead: isReadFilter,
      });
      setNotifications(data.notifications);
      setPagination(prev => ({
        ...prev,
        total: data.pagination.total,
      }));
    } catch (error) {
      console.error('Failed to load notifications:', error);
      message.error('加载通知失败');
    } finally {
      setLoading(false);
    }
  }, [pagination.current, pagination.pageSize, typeFilter, isReadFilter]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // 分页变化
  const handleTableChange = (paginationConfig: any) => {
    setPagination(prev => ({
      ...prev,
      current: paginationConfig.current,
      pageSize: paginationConfig.pageSize,
    }));
  };

  // 标记单条已读
  const handleMarkAsRead = async (id: string) => {
    try {
      await markAsRead(id);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, isRead: true } : n))
      );
      message.success('已标记为已读');
    } catch (error) {
      console.error('Failed to mark as read:', error);
      message.error('操作失败');
    }
  };

  // 全部标记已读
  const handleMarkAllAsRead = async () => {
    try {
      await markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      message.success('已全部标记为已读');
    } catch (error) {
      console.error('Failed to mark all as read:', error);
      message.error('操作失败');
    }
  };

  // 删除通知
  const handleDelete = async (id: string) => {
    try {
      await deleteNotification(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      setPagination(prev => ({ ...prev, total: prev.total - 1 }));
      message.success('通知已删除');
    } catch (error) {
      console.error('Failed to delete notification:', error);
      message.error('操作失败');
    }
  };

  // 设为新基线 (OP45)
  const handleSetAsBaseline = async (notification: Notification) => {
    if (!notification.relatedRecord?.templateId) {
      message.error('无法获取模板信息');
      return;
    }

    try {
      await regenerateBaseline(notification.relatedRecord.templateId);
      message.success('已设为新基线');
    } catch (error) {
      console.error('Failed to set as baseline:', error);
      message.error('操作失败');
    }
  };

  // 点击查看详情
  const handleViewDetails = (notification: Notification) => {
    // 如果未读，先标记已读
    if (!notification.isRead) {
      handleMarkAsRead(notification.id);
    }

    // 跳转到相关页面
    if (notification.type === 'inspection' || notification.type === 'report' || notification.type === 'baseline') {
      if (notification.relatedRecord?.id) {
        navigate(`/inspection?recordId=${notification.relatedRecord.id}`);
      } else {
        navigate('/inspection');
      }
    }
  };

  // 表格列定义
  const columns = [
    {
      title: '状态',
      key: 'status',
      width: 60,
      render: (_: any, record: Notification) => (
        !record.isRead ? (
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#1677ff', display: 'inline-block' }} />
        ) : null
      ),
    },
    {
      title: '类型',
      key: 'type',
      width: 90,
      render: (_: any, record: Notification) => {
        const typeInfo = notificationTypeMap[record.type] || { color: 'default', label: record.type };
        return <Tag color={typeInfo.color}>{typeInfo.label}</Tag>;
      },
    },
    {
      title: '标题',
      key: 'title',
      render: (_: any, record: Notification) => (
        <Text strong={!record.isRead} style={{ cursor: 'pointer' }} onClick={() => handleViewDetails(record)}>
          {record.title}
        </Text>
      ),
    },
    {
      title: '内容摘要',
      key: 'content',
      ellipsis: true,
      render: (_: any, record: Notification) => (
        <Text type="secondary">{record.content.substring(0, 100)}{record.content.length > 100 ? '...' : ''}</Text>
      ),
    },
    {
      title: '关联巡检',
      key: 'relatedRecord',
      width: 150,
      render: (_: any, record: Notification) => {
        if (!record.relatedRecord) return <Text type="secondary">-</Text>;
        const statusInfo = statusTypeMap[record.relatedRecord.status as keyof typeof statusTypeMap] || { color: 'default', label: record.relatedRecord.status };
        return (
          <Space direction="vertical" size={0}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.relatedRecord.template?.name || '未知模板'}
            </Text>
            <Tag color={statusInfo.color} style={{ marginRight: 0 }}>
              {statusInfo.label}
            </Tag>
          </Space>
        );
      },
    },
    {
      title: '时间',
      key: 'createdAt',
      width: 160,
      render: (_: any, record: Notification) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {formatTime(record.createdAt)}
        </Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_: any, record: Notification) => (
        <Space size="small">
          {!record.isRead && (
            <Button
              type="link"
              size="small"
              icon={<CheckOutlined />}
              onClick={() => handleMarkAsRead(record.id)}
            >
              已读
            </Button>
          )}
          {record.type === 'baseline' && record.relatedRecord?.templateId && (
            <Button
              type="link"
              size="small"
              icon={<FileTextOutlined />}
              onClick={() => handleSetAsBaseline(record)}
            >
              设为基线
            </Button>
          )}
          <Popconfirm
            title="确定删除此通知？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 统计未读数
  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>通知中心</Title>
        <Space>
          <Button
            icon={<CheckOutlined />}
            onClick={handleMarkAllAsRead}
          >
            全部已读
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={loadNotifications}
          >
            刷新
          </Button>
        </Space>
      </div>

      <Card bodyStyle={{ padding: 0 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: 16, alignItems: 'center' }}>
          <Space>
            <Text type="secondary">通知类型：</Text>
            <Select
              placeholder="全部类型"
              allowClear
              style={{ width: 120 }}
              value={typeFilter}
              onChange={value => {
                setTypeFilter(value);
                setPagination(prev => ({ ...prev, current: 1 }));
              }}
              options={[
                { label: '全部', value: undefined },
                { label: '巡检', value: 'inspection' },
                { label: '报告', value: 'report' },
                { label: '基线', value: 'baseline' },
                { label: '系统', value: 'system' },
              ]}
            />
          </Space>
          <Space>
            <Text type="secondary">阅读状态：</Text>
            <Select
              placeholder="全部"
              allowClear
              style={{ width: 100 }}
              value={isReadFilter}
              onChange={value => {
                setIsReadFilter(value);
                setPagination(prev => ({ ...prev, current: 1 }));
              }}
              options={[
                { label: '全部', value: undefined },
                { label: '未读', value: false },
                { label: '已读', value: true },
              ]}
            />
          </Space>
          <Text type="secondary">
            共 {pagination.total} 条通知，{unreadCount} 条未读
          </Text>
        </div>

        <Table
          columns={columns}
          dataSource={notifications}
          rowKey="id"
          loading={loading}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
          onChange={handleTableChange}
        />
      </Card>
    </div>
  );
}
