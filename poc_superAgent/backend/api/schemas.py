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
