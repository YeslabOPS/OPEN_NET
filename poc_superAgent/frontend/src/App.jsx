import { BrowserRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom"
import { ConfigProvider, Layout, Menu } from "antd"
import zhCN from "antd/locale/zh_CN"
import {
  MessageOutlined, DatabaseOutlined, CloudServerOutlined,
} from "@ant-design/icons"
import Chat from "./pages/Chat"
import KnowledgePage from "./pages/Knowledge"
import DevicesPage from "./pages/Devices"

const { Sider, Content } = Layout

const menuItems = [
  { key: "/", icon: <MessageOutlined />, label: "对话" },
  { key: "/knowledge", icon: <DatabaseOutlined />, label: "知识库" },
  { key: "/devices", icon: <CloudServerOutlined />, label: "设备管理" },
]

function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <Layout style={{ height: "100vh" }}>
      <Sider width={200} theme="light" style={{ borderRight: "1px solid #f0f0f0" }}>
        <div style={{
          height: 64, display: "flex", alignItems: "center",
          justifyContent: "center", fontWeight: "bold", fontSize: 16,
          borderBottom: "1px solid #f0f0f0",
        }}>
          Super Agent
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Content style={{ overflow: "auto" }}>
        <Routes>
          <Route path="/" element={<Chat />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/devices" element={<DevicesPage />} />
        </Routes>
      </Content>
    </Layout>
  )
}

function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 8,
        },
      }}
    >
      <BrowserRouter>
        <AppLayout />
      </BrowserRouter>
    </ConfigProvider>
  )
}

export default App
