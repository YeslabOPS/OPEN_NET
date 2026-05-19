"""Super Agent 核心类"""
import uuid
import logging
from typing import AsyncIterator, Optional
from dataclasses import dataclass, field
from datetime import datetime
from .llm_client import llm_client, DeepSeekLLM
from .executor import executor
from .planner import planner, TaskPlan, IntentType
from tools.knowledge_tool import search_knowledge, list_knowledge_docs
from tools.agent_tools import (
    ssh_connect_tool, ssh_execute_tool, ssh_disconnect_tool, list_connections_tool,
)

logger = logging.getLogger(__name__)


@dataclass
class Message:
    """消息结构"""
    role: str  # "user" | "assistant" | "system"
    content: str
    timestamp: datetime = field(default_factory=datetime.now)
    tools_used: list[str] = field(default_factory=list)
    plan: Optional[dict] = None  # 任务计划数据


@dataclass
class Session:
    """会话结构"""
    session_id: str
    user_id: str
    messages: list[Message] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    
    def add_message(self, role: str, content: str, tools_used: list[str] = None,
                    plan: dict = None):
        """添加消息"""
        self.messages.append(Message(
            role=role,
            content=content,
            tools_used=tools_used or [],
            plan=plan,
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
        
        # 注册内置工具
        self._register_tools()
        
        logger.info(f"SuperAgent '{name}' initialized")
    
    def _register_tools(self):
        """注册内置工具到执行器"""
        executor.register_tool("search_knowledge", search_knowledge)
        executor.register_tool("list_knowledge_docs", list_knowledge_docs)
        executor.register_tool("ssh_connect", ssh_connect_tool)
        executor.register_tool("ssh_execute", ssh_execute_tool)
        executor.register_tool("ssh_disconnect", ssh_disconnect_tool)
        executor.register_tool("list_connections", list_connections_tool)
        logger.info(f"Registered tools: {executor.list_tools()}")
    
    def _default_instruction(self) -> str:
        """默认系统提示"""
        return """你是网络巡检场景的 Super Agent，帮助用户完成网络设备巡检任务。

## 核心能力
1. 理解用户意图，识别网络巡检需求
2. 分解复杂巡检任务为可执行的子任务
3. 调用 SSH 工具连接网络设备执行巡检
4. 调用知识库获取网络设备和协议知识
5. 汇总巡检结果，生成巡检报告

## 可用工具

### 知识库工具
- search_knowledge(query): 搜索知识库，获取网络技术文档信息
- list_knowledge_docs(): 列举知识库中所有文档

### SSH 工具
- ssh_connect(host, port, username, password): 建立 SSH 连接到网络设备
- ssh_execute(connection_id, command): 在已连接的设备上执行命令
- ssh_disconnect(connection_id): 断开 SSH 连接
- list_connections(): 列出所有活跃的 SSH 连接

## 行为规范
1. 当用户询问技术问题时，优先调用 search_knowledge 搜索知识库
2. 对于巡检任务，先分解子任务（如：连接设备 → 执行命令 → 分析结果 → 生成报告）
3. 始终以专业、简洁的方式回答用户问题
4. 遇到不确定的信息，如实说明
5. 执行完命令后要及时断开 SSH 连接"""
    
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
    
    def _plan_to_dict(self, plan: TaskPlan) -> dict:
        """将 TaskPlan 转为字典"""
        return {
            "original_task": plan.original_task,
            "intent": plan.intent.value,
            "summary": plan.summary,
            "sub_tasks": [
                {
                    "task_id": t.task_id,
                    "description": t.description,
                    "tool_name": t.tool_name,
                    "params": t.params,
                    "depends_on": t.depends_on,
                    "status": t.status.value,
                    "result": t.result,
                    "error": t.error,
                }
                for t in plan.sub_tasks
            ],
        }
    
    async def plan_and_execute(self, message: str) -> dict:
        """规划并执行任务"""
        task_plan = await planner.plan(message)
        plan_data = self._plan_to_dict(task_plan)
        
        if task_plan.intent == IntentType.NETWORK_INSPECTION and task_plan.sub_tasks:
            plan_data["status"] = "planned"
            summary_lines = [
                f"检测到网络巡检任务，已分解为 {len(task_plan.sub_tasks)} 个子步骤。",
                "请确认是否需要执行以下计划：\n",
            ]
            for t in task_plan.sub_tasks:
                tool_info = f" [工具: {t.tool_name}]" if t.tool_name else ""
                summary_lines.append(f"  {t.task_id}. {t.description}{tool_info}")
            return {
                "plan": plan_data,
                "summary": "\n".join(summary_lines),
                "is_inspection": True,
            }
        
        return {
            "plan": plan_data,
            "summary": "",
            "is_inspection": False,
        }
    
    async def chat(self, session_id: str, message: str) -> dict:
        """处理对话"""
        session = self.get_session(session_id)
        if not session:
            session = self.create_session(user_id="unknown")
        
        # 添加用户消息
        session.add_message("user", message)
        
        try:
            # 1. 规划任务（仅用于识别意图和获取计划）
            task_plan = await planner.plan(message)
            plan_data = self._plan_to_dict(task_plan)
            
            # 2. 调用 LLM 生成回答
            history = self._format_history(session)
            history_for_api = [m for m in history if m["role"] != "system"]
            
            response = await self.llm.chat(
                prompt=message,
                history=history_for_api[:-1]
            )
            
            # 添加助手回复（含计划数据）
            session.add_message("assistant", response,
                              plan=plan_data if plan_data["sub_tasks"] else None)
            
            return {
                "response": response,
                "session_id": session_id,
                "plan": plan_data if plan_data["sub_tasks"] else None,
                "tools_used": [],
            }
        except Exception as e:
            logger.error(f"Agent error: {e}")
            error_msg = f"抱歉，处理请求时出错: {str(e)}"
            session.add_message("assistant", error_msg)
            return {
                "response": error_msg,
                "session_id": session_id,
                "error": str(e),
                "plan": None,
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
            
            session.add_message("assistant", full_response)
        except Exception as e:
            logger.error(f"Stream error: {e}")
            error_msg = f"抱歉，发生了错误: {str(e)}"
            session.add_message("assistant", error_msg)
            yield error_msg


# 全局 Agent 实例
agent = SuperAgent()
