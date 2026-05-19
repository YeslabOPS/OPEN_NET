import { useState, useEffect } from "react"
import {
  Table, Button, Modal, Card, Tag, Typography, Space,
  message, Alert, Input, Badge, Drawer,
} from "antd"
import {
  CompassOutlined, DeleteOutlined, ReloadOutlined,
  SearchOutlined, FileTextOutlined, CheckCircleOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons"
import ReactMarkdown from "react-markdown"
import { listDocuments, compileAll, compileOne, queryKnowledge, getWikiContent, indexWiki } from "../api/knowledge"

const { Text, Title } = Typography
const { TextArea } = Input

export default function KnowledgePage() {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [query, setQuery] = useState("")
  const [queryResult, setQueryResult] = useState(null)
  const [querying, setQuerying] = useState(false)
  const [previewDoc, setPreviewDoc] = useState(null)
  const [previewContent, setPreviewContent] = useState("")
  const [previewOpen, setPreviewOpen] = useState(false)

  const loadDocs = async () => {
    setLoading(true)
    try {
      const data = await listDocuments()
      setDocs(data)
    } catch (err) {
      message.error("加载文档列表失败")
    }
    setLoading(false)
  }

  useEffect(() => { loadDocs() }, [])

  const handleCompileAll = async () => {
    setCompiling(true)
    try {
      const result = await compileAll()
      const success = result.results.filter((r) => r.status === "success").length
      message.success(`编译完成: ${success} 个成功`)
      loadDocs()
    } catch {
      message.error("编译失败")
    }
    setCompiling(false)
  }

  const handleCompileOne = async (docId) => {
    try {
      await compileOne(docId)
      message.success("编译成功")
      loadDocs()
    } catch {
      message.error("编译失败")
    }
  }

  const handleQuery = async () => {
    if (!query.trim()) return
    setQuerying(true)
    try {
      const result = await queryKnowledge(query)
      setQueryResult(result)
    } catch {
      message.error("查询失败")
    }
    setQuerying(false)
  }

  const handlePreview = async (doc) => {
    setPreviewDoc(doc)
    setPreviewContent("")
    setPreviewOpen(true)
    if (doc.compiled) {
      try {
        const result = await getWikiContent(doc.id)
        setPreviewContent(result.content)
      } catch {
        setPreviewContent("加载内容失败")
      }
    } else {
      setPreviewContent("该文档尚未编译")
    }
  }

  const handleIndex = async () => {
    try {
      const result = await indexWiki()
      message.success(`索引完成: ${result.indexed_count} 个分块`)
    } catch {
      message.error("索引失败")
    }
  }

  const columns = [
    {
      title: "文档名称",
      dataIndex: "title",
      key: "title",
      render: (title, record) => (
        <a onClick={() => handlePreview(record)}>
          <FileTextOutlined style={{ marginRight: 8 }} />
          {title}
        </a>
      ),
    },
    {
      title: "状态",
      dataIndex: "compiled",
      key: "compiled",
      width: 100,
      render: (compiled) => compiled
        ? <Tag icon={<CheckCircleOutlined />} color="success">已编译</Tag>
        : <Tag icon={<CloseCircleOutlined />} color="default">未编译</Tag>,
    },
    {
      title: "标签",
      dataIndex: "tags",
      key: "tags",
      width: 200,
      render: (tags) => (tags || []).map((t) => <Tag key={t}>{t}</Tag>),
    },
    {
      title: "操作",
      key: "action",
      width: 160,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            icon={<CompassOutlined />}
            disabled={record.compiled}
            onClick={() => handleCompileOne(record.id)}
          >
            编译
          </Button>
          <Button size="small" onClick={() => handlePreview(record)}>
            预览
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      {/* 标题栏 */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 16,
      }}>
        <Title level={4} style={{ margin: 0 }}>知识库管理</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadDocs}>刷新</Button>
          <Button icon={<ReloadOutlined />} onClick={handleIndex}>重建索引</Button>
          <Button type="primary" icon={<CompassOutlined />}
            loading={compiling} onClick={handleCompileAll}>
            编译全部
          </Button>
        </Space>
      </div>

      {/* 文档列表 */}
      <Card style={{ marginBottom: 16 }}>
        <Table
          dataSource={docs}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="middle"
        />
      </Card>

      {/* 查询 */}
      <Card title="知识库查询" style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%" }} direction="vertical">
          <TextArea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入你的问题..."
            rows={2}
          />
          <Button type="primary" icon={<SearchOutlined />}
            onClick={handleQuery} loading={querying}>
            查询
          </Button>
        </Space>
        {queryResult && (
          <div style={{
            marginTop: 12, padding: 12, background: "#f6f8fa",
            borderRadius: 8,
          }}>
            <ReactMarkdown>{queryResult.answer}</ReactMarkdown>
            {queryResult.sources?.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#888" }}>
                参考来源: {queryResult.sources.length} 个
              </div>
            )}
          </div>
        )}
      </Card>

      {/* 预览 Drawer */}
      <Drawer
        title={previewDoc?.title || "文档预览"}
        placement="right"
        width={600}
        onClose={() => setPreviewOpen(false)}
        open={previewOpen}
      >
        <ReactMarkdown>{previewContent}</ReactMarkdown>
      </Drawer>
    </div>
  )
}
