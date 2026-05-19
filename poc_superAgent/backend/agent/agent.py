"""Super Agent 核心类"""
import uuid
import logging
from typing import AsyncIterator, Optional
from dataclasses import dataclass, field
from datetime import datetime
from .llm_client import llm_client, DeepSeekLLM

logger = logging.getLogger(__name__)


@dataclass
class Message:
    """消息结构"""
    role: str  # "user" | "assistant" | "system"
    content: str
    timestamp: datetime = field(default_factory=datetime.now)
    tools_used: list[str] = field(default_factory=list)


@dataclass
class Session:
    """会话结构"""
    session_id: str
    user_id: str
    messages: list[Message] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    
    def add_message(self, role: str, content: str, tools_used: list[str] = None):
        """添加消息"""
        self.messages.append(Message(
            role=role,
            content=content,
            tools_used=tools_used or []
        ))


class SuperAgent:
    """Super Agent 核心类"""
    
    def __init__(
        self,
        name: str = "SuperAgent",
        description: str = "网络巡检场景超级代理",
        instruction: str = None,
        llm: DeepSeekLLM = None,
    ):
        self.name = name
        self.description = description
        self.instruction = instruction or self._default_instruction()
        self.llm = llm or llm_client
        
        # 会话存储 (内存)
        self._sessions: dict[str, Session] = {}
        
        logger.info(f"SuperAgent '{name}' initialized")
    
    def _default_instruction(self) -> str:
        """默认系统提示"""
        return """你是网络巡检场景的 Super Agent，帮助用户完成网络设备巡检任务。

核心能力：
1. 理解用户意图，识别网络巡检需求
2. 分解复杂巡检任务为可执行的子任务
3. 调用 SSH 工具连接网络设备执行巡检
4. 调用知识库获取网络设备和协议知识
5. 汇总巡检结果，生成巡检报告

请始终以专业、简洁的方式回答用户问题。"""
    
    def create_session(self, user_id: str = "default") -> Session:
        """创建新会话"""
        session_id = str(uuid.uuid4())
        session = Session(session_id=session_id, user_id=user_id)
        self._sessions[session_id] = session
        
        # 添加系统消息
        session.add_message("system", self.instruction)
        
        logger.info(f"Session created: {session_id}")
        return session
    
    def get_session(self, session_id: str) -> Optional[Session]:
        """获取会话"""
        return self._sessions.get(session_id)
    
    def _format_history(self, session: Session) -> list[dict]:
        """格式化历史消息"""
        return [
            {"role": msg.role, "content": msg.content}
            for msg in session.messages
        ]
    
    async def chat(self, session_id: str, message: str) -> dict:
        """处理对话"""
        session = self.get_session(session_id)
        if not session:
            session = self.create_session(user_id="unknown")
        
        # 添加用户消息
        session.add_message("user", message)
        
        # 调用 LLM
        history = self._format_history(session)
        # 移除系统消息，因为 LLM 会处理
        history_for_api = [m for m in history if m["role"] != "system"]
        
        try:
            response = await self.llm.chat(
                prompt=message,
                history=history_for_api[:-1]  # 不包含当前用户消息
            )
            
            # 添加助手回复
            session.add_message("assistant", response)
            
            return {
                "response": response,
                "session_id": session_id,
                "tools_used": [],
            }
        except Exception as e:
            logger.error(f"LLM error: {e}")
            error_msg = f"抱歉，发生了错误: {str(e)}"
            session.add_message("assistant", error_msg)
            return {
                "response": error_msg,
                "session_id": session_id,
                "error": str(e),
            }
    
    async def chat_stream(self, session_id: str, message: str) -> AsyncIterator[str]:
        """流式对话"""
        session = self.get_session(session_id)
        if not session:
            session = self.create_session(user_id="unknown")
        
        session.add_message("user", message)
        history = self._format_history(session)
        history_for_api = [m for m in history if m["role"] != "system"]
        
        full_response = ""
        try:
            async for chunk in self.llm.chat_stream(
                prompt=message,
                history=history_for_api[:-1]
            ):
                full_response += chunk
                yield chunk
            
            # 保存完整响应
            session.add_message("assistant", full_response)
        except Exception as e:
            logger.error(f"Stream error: {e}")
            error_msg = f"抱歉，发生了错误: {str(e)}"
            session.add_message("assistant", error_msg)
            yield error_msg


# 全局 Agent 实例
agent = SuperAgent()
