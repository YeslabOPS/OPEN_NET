import { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Typography, Space, message, Divider, Spin } from 'antd';
import { SaveOutlined, KeyOutlined, GlobalOutlined } from '@ant-design/icons';
import { useConfigStore } from '../../stores/configStore';

const { Title, Text } = Typography;

function Settings() {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const { updateConfig, config } = useConfigStore();

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch('/api/config');
        const result = await response.json();
        if (result.success && result.data) {
          const configMap: Record<string, string> = {};
          result.data.forEach((item: { key: string; value: string }) => {
            configMap[item.key] = item.value;
          });
          form.setFieldsValue({
            apiKey: configMap.api_key || config.apiKey || '',
            apiBaseUrl: configMap.api_base_url || config.apiBaseUrl || 'https://api.deepseek.com',
            defaultModel: configMap.default_model || config.defaultModel || 'deepseek-chat',
          });
        }
      } catch (error) {
        // 从本地 store 恢复
        form.setFieldsValue({
          apiKey: config.apiKey,
          apiBaseUrl: config.apiBaseUrl,
          defaultModel: config.defaultModel,
        });
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
  }, []);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      // 保存到后端
      const configs = [
        { key: 'api_key', value: values.apiKey },
        { key: 'api_base_url', value: values.apiBaseUrl },
        { key: 'default_model', value: values.defaultModel },
      ];

      for (const cfg of configs) {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg),
        });
        const result = await response.json();
        if (!result.success) {
          throw new Error(`保存配置 ${cfg.key} 失败`);
        }
      }

      // 同步更新本地 store
      updateConfig({
        apiKey: values.apiKey,
        apiBaseUrl: values.apiBaseUrl,
        defaultModel: values.defaultModel,
      });

      message.success('配置已保存');
    } catch (error: any) {
      if (error.errorFields) {
        return;
      }
      message.error(error.message || '保存配置失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Title level={3}>系统配置</Title>

      <Card style={{ marginTop: 16 }} title="API 配置">
        <Spin spinning={loading}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            apiKey: '',
            apiBaseUrl: 'https://api.deepseek.com',
            defaultModel: 'deepseek-chat',
          }}
        >
          <Form.Item
            name="apiKey"
            label="DeepSeek API Key"
            rules={[{ required: true, message: '请输入 API Key' }]}
            extra={
              <Text type="secondary">
                请前往 DeepSeek 官网获取 API Key：
                <a href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer">
                  https://platform.deepseek.com
                </a>
              </Text>
            }
          >
            <Input.Password
              prefix={<KeyOutlined />}
              placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
            />
          </Form.Item>

          <Form.Item
            name="apiBaseUrl"
            label="API Base URL"
            extra="DeepSeek API 的基础地址，通常不需要修改"
          >
            <Input prefix={<GlobalOutlined />} placeholder="https://api.deepseek.com" />
          </Form.Item>

          <Divider />

          <Form.Item
            name="defaultModel"
            label="默认模型"
            extra="用于 Agent 对话的默认 LLM 模型"
          >
            <Input placeholder="deepseek-chat" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
              保存配置
            </Button>
          </Form.Item>
        </Form>
        </Spin>
      </Card>

      <Card style={{ marginTop: 16 }} title="关于">
        <Space direction="vertical">
          <Text>
            <strong>NetOps Agent Skills</strong> v0.1.0
          </Text>
          <Text type="secondary">
            面向计算机网络运维领域的智能 Agent 构建与运行平台
          </Text>
          <Text type="secondary">
            基于 Agent + Skills 架构，使用 DeepSeek API 作为 LLM 引擎
          </Text>
        </Space>
      </Card>
    </div>
  );
}

export default Settings;
