"""任务规划器"""
import json
import logging
from typing import Optional
from dataclasses import dataclass, field
from enum import Enum
from .llm_client import llm_client

logger = logging.getLogger(__name__)


class TaskStatus(str, Enum):
    """任务状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class IntentType(str, Enum):
    """意图类型"""
    NETWORK_INSPECTION = "network_inspection"  # 网络巡检
    DEVICE_QUERY = "device_query"              # 设备查询
    KNOWLEDGE_QUERY = "knowledge_query"         # 知识查询
    GENERAL = "general"                         # 通用对话


@dataclass
class SubTask:
    """子任务"""
    task_id: str
    description: str
    tool_name: Optional[str] = None
    params: dict = field(default_factory=dict)
    depends_on: list[str] = field(default_factory=list)
    status: TaskStatus = TaskStatus.PENDING
    result: Optional[str] = None
    error: Optional[str] = None


@dataclass
class TaskPlan:
    """任务计划"""
    original_task: str
    intent: IntentType
    sub_tasks: list[SubTask]
    summary: str = ""


class Planner:
    """任务规划器"""
    
    INTENT_PROMPT = """分析用户意图，判断任务类型。

任务类型：
- network_inspection: 网络设备巡检任务（如检查路由器状态、查看端口、获取设备信息等）
- device_query: 设备信息查询
- knowledge_query: 知识库查询
- general: 通用对话

用户消息: {message}

请只返回一个 JSON 对象，包含 intent 字段：
{{"intent": "任务类型"}}
"""

    DECOMPOSE_PROMPT = """将以下网络巡检任务分解为具体的子任务步骤。

任务: {task}

请返回一个 JSON 数组，每个元素是一个子任务：
[
  {{
    "task_id": "step_1",
    "description": "子任务描述",
    "tool_name": "使用的工具名称（如 ssh_execute, search_knowledge）",
    "params": {{"参数名": "参数值"}},
    "depends_on": []
  }}
]

要求：
1. 任务分解要具体、可执行
2. 确定每个子任务需要的工具
3. 确定任务之间的依赖关系
4. 返回纯 JSON，不要其他内容
"""

    def __init__(self, llm=None):
        self.llm = llm or llm_client
    
    async def classify_intent(self, user_message: str) -> IntentType:
        """识别用户意图"""
        try:
            prompt = self.INTENT_PROMPT.format(message=user_message)
            response = await self.llm.chat(prompt=prompt)
            
            # 解析 JSON 响应
            result = json.loads(response)
            intent_str = result.get("intent", "general")
            
            # 映射到 IntentType
            intent_map = {
                "network_inspection": IntentType.NETWORK_INSPECTION,
                "device_query": IntentType.DEVICE_QUERY,
                "knowledge_query": IntentType.KNOWLEDGE_QUERY,
                "general": IntentType.GENERAL,
            }
            
            return intent_map.get(intent_str, IntentType.GENERAL)
        except Exception as e:
            logger.warning(f"Intent classification failed: {e}, defaulting to GENERAL")
            return IntentType.GENERAL
    
    async def decompose(self, task_description: str) -> list[SubTask]:
        """分解任务"""
        try:
            prompt = self.DECOMPOSE_PROMPT.format(task=task_description)
            response = await self.llm.chat(prompt=prompt)
            
            # 解析 JSON 响应
            tasks_data = json.loads(response)
            
            sub_tasks = []
            for task_data in tasks_data:
                sub_tasks.append(SubTask(
                    task_id=task_data["task_id"],
                    description=task_data["description"],
                    tool_name=task_data.get("tool_name"),
                    params=task_data.get("params", {}),
                    depends_on=task_data.get("depends_on", []),
                ))
            
            return sub_tasks
        except Exception as e:
            logger.error(f"Task decomposition failed: {e}")
            return []
    
    async def plan(self, user_message: str) -> TaskPlan:
        """制定执行计划"""
        # 1. 识别意图
        intent = await self.classify_intent(user_message)
        
        # 2. 如果是网络巡检任务，分解为子任务
        sub_tasks = []
        if intent == IntentType.NETWORK_INSPECTION:
            sub_tasks = await self.decompose(user_message)
        
        return TaskPlan(
            original_task=user_message,
            intent=intent,
            sub_tasks=sub_tasks,
        )
    
    def to_dict(self, plan: TaskPlan) -> dict:
        """转换为字典"""
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


# 全局规划器实例
planner = Planner()
