import { Form, Input, Button, Card, Typography, Space, message, Divider } from 'antd';
import { SaveOutlined, KeyOutlined, GlobalOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

function Settings() {
  const [form] = Form.useForm();

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      message.success('配置已保存');
      console.log('Saved config:', values);
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  return (
    <div>
      <Title level={3}>系统配置</Title>

      <Card style={{ marginTop: 16 }} title="API 配置">
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
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
              保存配置
            </Button>
          </Form.Item>
        </Form>
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
