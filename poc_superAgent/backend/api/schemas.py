"""API 请求/响应模型"""
from pydantic import BaseModel, Field
from typing import Optional


class ChatRequest(BaseModel):
    """对话请求"""
    message: str = Field(..., description="用户消息")
    session_id: Optional[str] = Field(None, description="会话 ID，为空则创建新会话")


class ChatResponse(BaseModel):
    """对话响应"""
    response: str = Field(..., description="Agent 回复")
    session_id: str = Field(..., description="会话 ID")
    tools_used: list[str] = Field(default_factory=list, description="使用的工具列表")
    plan: Optional[dict] = Field(None, description="任务执行计划")


class PlanRequest(BaseModel):
    """规划请求"""
    message: str = Field(..., description="用户消息")


class PlanResponse(BaseModel):
    """规划响应"""
    plan: dict = Field(..., description="任务计划")
    summary: str = Field("", description="执行摘要")
    is_inspection: bool = Field(False, description="是否为巡检任务")


class StreamChatRequest(BaseModel):
    """流式对话请求"""
    message: str = Field(..., description="用户消息")
    session_id: Optional[str] = Field(None, description="会话 ID")


class SessionInfo(BaseModel):
    """会话信息"""
    session_id: str
    user_id: str
    message_count: int
    created_at: str


class ErrorResponse(BaseModel):
    """错误响应"""
    error: str = Field(..., description="错误信息")
    detail: Optional[str] = Field(None, description="详细错误")


# ── 知识库相关 ──

class DocumentInfo(BaseModel):
    """文档信息"""
    id: str
    title: str
    compiled: bool
    compiled_path: str
    created_at: str
    tags: list[str] = Field(default_factory=list)


class KnowledgeCompileResponse(BaseModel):
    """编译响应"""
    id: str
    status: str
    compiled_path: Optional[str] = None
    error: Optional[str] = None


class KnowledgeQueryRequest(BaseModel):
    """知识库查询请求"""
    question: str = Field(..., description="查询问题")


class KnowledgeQueryResponse(BaseModel):
    """知识库查询响应"""
    answer: str
    sources: list[dict] = Field(default_factory=list, description="参考来源")
