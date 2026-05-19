"""MCP Server 框架 - 简化版工具注册与调度"""
import logging
from typing import Callable, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class ToolDef:
    """工具定义"""
    
    def __init__(self, name: str, description: str, 
                 parameters: dict, handler: Callable):
        self.name = name
        self.description = description
        self.parameters = parameters  # JSON Schema
        self.handler = handler
    
    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
        }
    
    async def call(self, **kwargs) -> Any:
        """调用工具"""
        logger.info(f"MCP call: {self.name}({kwargs})")
        try:
            result = await self.handler(**kwargs)
            return {"status": "success", "data": result}
        except Exception as e:
            logger.error(f"MCP call failed: {self.name} - {e}")
            return {"status": "error", "error": str(e)}


class MCPServer:
    """MCP Server 框架"""
    
    def __init__(self, name: str = "super-agent"):
        self.name = name
        self._tools: dict[str, ToolDef] = {}
        self._call_history: list[dict] = []
    
    def register_tool(self, name: str, description: str, 
                      parameters: dict, handler: Callable):
        """注册工具"""
        tool = ToolDef(name, description, parameters, handler)
        self._tools[name] = tool
        logger.info(f"MCP tool registered: {name}")
    
    def get_tool(self, name: str) -> Optional[ToolDef]:
        """获取工具"""
        return self._tools.get(name)
    
    def list_tools(self) -> list[dict]:
        """列出所有工具"""
        return [t.to_dict() for t in self._tools.values()]
    
    async def call_tool(self, name: str, **kwargs) -> dict:
        """调用工具"""
        tool = self.get_tool(name)
        if not tool:
            return {"status": "error", "error": f"Tool not found: {name}"}
        
        result = await tool.call(**kwargs)
        
        # 记录调用历史
        self._call_history.append({
            "tool": name,
            "params": kwargs,
            "result": result,
            "timestamp": datetime.now().isoformat(),
        })
        
        return result
    
    def get_history(self, limit: int = 10) -> list[dict]:
        """获取调用历史"""
        return self._call_history[-limit:]


# 全局 MCP Server 实例
mcp_server = MCPServer(name="super-agent")
