/**
 * 通知铃铛组件 (OP41)
 * 顶部导航栏右侧铃铛图标，Badge 显示未读数，点击弹出 Drawer 展示最近通知
 */

import { useState, useEffect, useCallback } from 'react';
import { Badge, Drawer, List, Typography, Button, Spin, Empty, Tag, Space } from 'antd';
import { BellOutlined, EyeOutlined, DeleteOutlined, CheckOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification, type Notification } from '../api/notification';

const { Text, Title } = Typography;

const notificationTypeMap: Record<string, { color: string; label: string }> = {
  inspection: { color: 'blue', label: '巡检' },
  report: { color: 'green', label: '报告' },
  baseline: { color: 'orange', label: '基线' },
  system: { color: 'default', label: '系统' },
};

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return date.toLocaleDateString('zh-CN');
}

function truncateContent(content: string, maxLength: number = 80): string {
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength) + '...';
}

interface NotificationBellProps {
  onNotificationCountChange?: (count: number) => void;
}

export default function NotificationBell({ onNotificationCountChange }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const navigate = useNavigate();

  // 加载未读数量
  const loadUnreadCount = useCallback(async () => {
    try {
      const count = await getUnreadCount();
      setUnreadCount(count);
      onNotificationCountChange?.(count);
    } catch (error) {
      console.error('Failed to load unread count:', error);
    }
  }, [onNotificationCountChange]);

  // 加载最近通知
  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getNotifications({ page: 1, pageSize: 10 });
      setNotifications(data.notifications);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadUnreadCount();
    // 每 30 秒刷新一次未读数
    const interval = setInterval(loadUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [loadUnreadCount]);

  // 打开抽屉时加载通知
  useEffect(() => {
    if (open) {
      loadNotifications();
    }
  }, [open, loadNotifications]);

  // 标记单条已读
  const handleMarkAsRead = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await markAsRead(id);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
      onNotificationCountChange?.(unreadCount - 1);
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  // 全部标记已读
  const handleMarkAllAsRead = async () => {
    try {
      await markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
      onNotificationCountChange?.(0);
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  // 删除通知
  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await deleteNotification(id);
      const notification = notifications.find(n => n.id === id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      if (notification && !notification.isRead) {
        setUnreadCount(prev => Math.max(0, prev - 1));
        onNotificationCountChange?.(unreadCount - 1);
      }
    } catch (error) {
      console.error('Failed to delete notification:', error);
    }
  };

  // 点击通知
  const handleNotificationClick = (notification: Notification) => {
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
    setOpen(false);
  };

  // 跳转到通知中心
  const handleGoToCenter = () => {
    navigate('/notifications');
    setOpen(false);
  };

  return (
    <>
      <Badge count={unreadCount} size="small" offset={[-2, 2]}>
        <Button
          type="text"
          icon={<BellOutlined style={{ fontSize: 18 }} />}
          onClick={() => setOpen(true)}
          style={{ color: '#fff' }}
        />
      </Badge>

      <Drawer
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>通知中心</span>
            {unreadCount > 0 && (
              <Button
                type="link"
                size="small"
                icon={<CheckOutlined />}
                onClick={handleMarkAllAsRead}
              >
                全部已读
              </Button>
            )}
          </div>
        }
        placement="right"
        onClose={() => setOpen(false)}
        open={open}
        width={420}
        footer={
          <div style={{ textAlign: 'center' }}>
            <Button type="link" onClick={handleGoToCenter}>
              查看全部通知
            </Button>
          </div>
        }
      >
        <Spin spinning={loading}>
          {notifications.length === 0 ? (
            <Empty description="暂无通知" style={{ marginTop: 60 }} />
          ) : (
            <List
              dataSource={notifications}
              renderItem={notification => {
                const typeInfo = notificationTypeMap[notification.type] || { color: 'default', label: notification.type };
                return (
                  <List.Item
                    key={notification.id}
                    style={{
                      padding: '12px 0',
                      cursor: 'pointer',
                      backgroundColor: notification.isRead ? 'transparent' : 'rgba(24, 144, 255, 0.04)',
                      borderRadius: 4,
                      paddingLeft: 8,
                      paddingRight: 8,
                    }}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <Space size={4}>
                          {!notification.isRead && (
                            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#1677ff', display: 'inline-block' }} />
                          )}
                          <Text strong={!notification.isRead} style={{ fontSize: 14 }}>
                            {notification.title}
                          </Text>
                        </Space>
                        <Space size={4}>
                          <Tag color={typeInfo.color} style={{ margin: 0 }}>
                            {typeInfo.label}
                          </Tag>
                        </Space>
                      </div>
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                        {truncateContent(notification.content)}
                      </Text>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {formatTime(notification.createdAt)}
                        </Text>
                        <Space size={4}>
                          {!notification.isRead && (
                            <Button
                              type="text"
                              size="small"
                              icon={<EyeOutlined />}
                              onClick={e => handleMarkAsRead(notification.id, e)}
                              title="标记已读"
                            />
                          )}
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={e => handleDelete(notification.id, e)}
                            title="删除"
                          />
                        </Space>
                      </div>
                    </div>
                  </List.Item>
                );
              }}
            />
          )}
        </Spin>
      </Drawer>
    </>
  );
}
