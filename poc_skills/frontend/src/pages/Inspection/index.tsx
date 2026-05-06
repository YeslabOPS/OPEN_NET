/**
 * 巡检页面 Tab 容器 (OP34)
 * 即时巡检 / 巡检模板 / 历史报告 三个 Tab
 */

import { Tabs } from 'antd';
import { ThunderboltOutlined, FolderOutlined, HistoryOutlined, ClockCircleOutlined } from '@ant-design/icons';
import InspectionNow from './InspectionNow';
import TemplateManagement from './TemplateManagement';
import HistoryReports from './HistoryReports';
import ScheduleManagement from './ScheduleManagement';

const { TabPane } = Tabs;

function InspectionPage() {
  return (
    <Tabs
      defaultActiveKey="inspection"
      size="large"
      items={[
        {
          key: 'inspection',
          label: (
            <span>
              <ThunderboltOutlined />
              即时巡检
            </span>
          ),
          children: <InspectionNow />,
        },
        {
          key: 'templates',
          label: (
            <span>
              <FolderOutlined />
              巡检模板
            </span>
          ),
          children: <TemplateManagement />,
        },
        {
          key: 'history',
          label: (
            <span>
              <HistoryOutlined />
              历史报告
            </span>
          ),
          children: <HistoryReports />,
        },
        {
          key: 'schedules',
          label: (
            <span>
              <ClockCircleOutlined />
              定时任务
            </span>
          ),
          children: <ScheduleManagement />,
        },
      ]}
    />
  );
}

export default InspectionPage;
