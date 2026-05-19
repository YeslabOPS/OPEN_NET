"""执行调度器"""
import asyncio
import logging
from typing import Callable, Awaitable, Optional
from .planner import TaskPlan, SubTask, TaskStatus

logger = logging.getLogger(__name__)


class Executor:
    """执行调度器"""
    
    def __init__(self):
        # 工具注册表: tool_name -> callable
        self._tools: dict[str, Callable] = {}
    
    def register_tool(self, name: str, func: Callable):
        """注册工具"""
        self._tools[name] = func
        logger.info(f"Tool registered: {name}")
    
    def get_tool(self, name: str) -> Optional[Callable]:
        """获取工具"""
        return self._tools.get(name)
    
    def list_tools(self) -> list[str]:
        """列出所有工具"""
        return list(self._tools.keys())
    
    async def execute_task(self, task: SubTask) -> SubTask:
        """执行单个任务"""
        task.status = TaskStatus.RUNNING
        
        if not task.tool_name:
            task.status = TaskStatus.COMPLETED
            task.result = "无需工具执行"
            return task
        
        tool = self.get_tool(task.tool_name)
        if not tool:
            task.status = TaskStatus.FAILED
            task.error = f"Tool not found: {task.tool_name}"
            return task
        
        try:
            # 执行工具
            if asyncio.iscoroutinefunction(tool):
                result = await tool(**task.params)
            else:
                result = tool(**task.params)
            
            task.status = TaskStatus.COMPLETED
            task.result = str(result) if result else "执行成功"
            logger.info(f"Task {task.task_id} completed")
        except Exception as e:
            task.status = TaskStatus.FAILED
            task.error = str(e)
            logger.error(f"Task {task.task_id} failed: {e}")
        
        return task
    
    async def _can_execute(self, task: SubTask, completed: set[str]) -> bool:
        """检查任务是否满足执行条件"""
        for dep in task.depends_on:
            if dep not in completed:
                return False
        return True
    
    async def execute_plan(
        self,
        plan: TaskPlan,
        skip_on_failure: bool = True,
    ) -> TaskPlan:
        """执行整个计划"""
        completed: set[str] = set()
        failed: set[str] = set()
        
        # 迭代执行直到所有任务完成
        max_iterations = len(plan.sub_tasks) * 2  # 防止无限循环
        iteration = 0
        
        while iteration < max_iterations:
            iteration += 1
            made_progress = False
            
            for task in plan.sub_tasks:
                if task.status != TaskStatus.PENDING:
                    continue
                
                # 检查依赖是否满足
                if not await self._can_execute(task, completed):
                    continue
                
                # 执行任务
                await self.execute_task(task)
                made_progress = True
                
                # 处理结果
                if task.status == TaskStatus.COMPLETED:
                    completed.add(task.task_id)
                elif task.status == TaskStatus.FAILED:
                    failed.add(task.task_id)
                    if skip_on_failure:
                        # 标记依赖此任务的任务为跳过
                        for t in plan.sub_tasks:
                            if task.task_id in t.depends_on:
                                t.status = TaskStatus.SKIPPED
            
            # 检查是否全部完成
            pending = [t for t in plan.sub_tasks if t.status == TaskStatus.PENDING]
            if not pending:
                break
            
            # 如果没有进展且还有待执行任务，可能有循环依赖
            if not made_progress and pending:
                logger.warning("Potential circular dependency detected")
                break
        
        # 生成总结
        plan.summary = self._generate_summary(plan)
        return plan
    
    def _generate_summary(self, plan: TaskPlan) -> str:
        """生成执行总结"""
        total = len(plan.sub_tasks)
        completed = sum(1 for t in plan.sub_tasks if t.status == TaskStatus.COMPLETED)
        failed = sum(1 for t in plan.sub_tasks if t.status == TaskStatus.FAILED)
        skipped = sum(1 for t in plan.sub_tasks if t.status == TaskStatus.SKIPPED)
        
        summary = f"执行完成: {completed}/{total} 个任务成功"
        if failed > 0:
            summary += f", {failed} 个失败"
        if skipped > 0:
            summary += f", {skipped} 个跳过"
        
        return summary
    
    def summarize_results(self, plan: TaskPlan) -> str:
        """汇总结果"""
        lines = [f"任务计划: {plan.original_task}", ""]
        
        for task in plan.sub_tasks:
            status_icon = {
                TaskStatus.COMPLETED: "✅",
                TaskStatus.FAILED: "❌",
                TaskStatus.SKIPPED: "⏭️",
                TaskStatus.RUNNING: "🔄",
                TaskStatus.PENDING: "⏳",
            }.get(task.status, "?")
            
            lines.append(f"{status_icon} [{task.task_id}] {task.description}")
            
            if task.status == TaskStatus.COMPLETED and task.result:
                lines.append(f"   结果: {task.result}")
            elif task.status == TaskStatus.FAILED and task.error:
                lines.append(f"   错误: {task.error}")
            elif task.status == TaskStatus.SKIPPED:
                lines.append(f"   原因: 依赖任务失败")
        
        lines.append("")
        lines.append(plan.summary)
        
        return "\n".join(lines)


# 全局执行器实例
executor = Executor()
