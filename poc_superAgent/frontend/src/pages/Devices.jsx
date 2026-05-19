import { useState, useEffect } from "react"
import {
  Table, Button, Modal, Form, Input, InputNumber,
  Select, Card, Typography, Space, message, Tag, Popconfirm,
} from "antd"
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  ApiOutlined, ReloadOutlined, CheckCircleOutlined,
  CloseCircleOutlined, SyncOutlined,
} from "@ant-design/icons"
import {
  listDevices, addDevice, updateDevice, deleteDevice, testConnection,
} from "../api/devices"

const { Title } = Typography

const deviceTypes = [
  { value: "router", label: "路由器" },
  { value: "switch", label: "交换机" },
  { value: "firewall", label: "防火墙" },
  { value: "server", label: "服务器" },
  { value: "other", label: "其他" },
]

export default function DevicesPage() {
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingDevice, setEditingDevice] = useState(null)
  const [testing, setTesting] = useState({})
  const [form] = Form.useForm()

  const loadDevices = async () => {
    setLoading(true)
    try {
      const data = await listDevices()
      setDevices(data)
    } catch {
      message.error("加载设备列表失败")
    }
    setLoading(false)
  }

  useEffect(() => { loadDevices() }, [])

  const openAdd = () => {
    setEditingDevice(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (device) => {
    setEditingDevice(device)
    form.setFieldsValue(device)
    setModalOpen(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      if (editingDevice) {
        await updateDevice(editingDevice.id, values)
        message.success("设备已更新")
      } else {
        await addDevice(values)
        message.success("设备已添加")
      }
      setModalOpen(false)
      loadDevices()
    } catch (err) {
      if (err.errorFields) return // form validation
      message.error("保存失败")
    }
  }

  const handleDelete = async (id) => {
    try {
      await deleteDevice(id)
      message.success("设备已删除")
      loadDevices()
    } catch {
      message.error("删除失败")
    }
  }

  const handleTest = async (device) => {
    setTesting((prev) => ({ ...prev, [device.id]: true }))
    try {
      const result = await testConnection({
        host: device.host,
        port: device.port,
        username: device.username,
        password: device.password || "",
      })
      if (result.status === "success") {
        message.success(`${device.name}: 连接测试成功`)
      } else {
        message.warning(`${device.name}: ${result.message}`)
      }
    } catch {
      message.error("测试请求失败")
    }
    setTesting((prev) => ({ ...prev, [device.id]: false }))
  }

  const columns = [
    { title: "设备名称", dataIndex: "name", key: "name" },
    { title: "主机地址", dataIndex: "host", key: "host" },
    { title: "端口", dataIndex: "port", key: "port", width: 80 },
    { title: "用户名", dataIndex: "username", key: "username" },
    {
      title: "类型",
      dataIndex: "device_type",
      key: "device_type",
      width: 100,
      render: (t) => {
        const label = deviceTypes.find((d) => d.value === t)?.label || t
        return <Tag>{label}</Tag>
      },
    },
    {
      title: "操作",
      key: "action",
      width: 220,
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<SyncOutlined />}
            loading={testing[record.id]}
            onClick={() => handleTest(record)}>
            测试
          </Button>
          <Button size="small" icon={<EditOutlined />}
            onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除?" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 16,
      }}>
        <Title level={4} style={{ margin: 0 }}>设备管理</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadDevices}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            添加设备
          </Button>
        </Space>
      </div>

      <Card>
        <Table
          dataSource={devices}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="middle"
        />
      </Card>

      <Modal
        title={editingDevice ? "编辑设备" : "添加设备"}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="设备名称" rules={[{ required: true }]}>
            <Input placeholder="核心路由器-01" />
          </Form.Item>
          <Form.Item name="host" label="主机地址" rules={[{ required: true }]}>
            <Input placeholder="192.168.1.1" />
          </Form.Item>
          <Form.Item name="port" label="SSH 端口" initialValue={22}>
            <InputNumber min={1} max={65535} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input placeholder="admin" />
          </Form.Item>
          <Form.Item name="password" label="密码">
            <Input.Password placeholder="留空使用密钥认证" />
          </Form.Item>
          <Form.Item name="device_type" label="设备类型" initialValue="router">
            <Select options={deviceTypes} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="设备备注说明" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
