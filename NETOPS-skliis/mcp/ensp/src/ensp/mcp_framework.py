"""
轻量级 MCP 框架
模拟官方 FastMCP SDK 的装饰器风格，纯标准库实现，Python 3.8+
"""
import json
import sys
import asyncio
import inspect
import logging
from typing import Dict, List, Any, Optional, Callable, Union

logger = logging.getLogger(__name__)

# Python 类型到 JSON Schema 类型的映射
_TYPE_MAP = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
    list: "array",
    dict: "object",
    type(None): "null",
}


def _py_type_to_schema(py_type, default=None) -> dict:
    """将 Python 类型转换为 JSON Schema 片段"""
    # 处理 Optional[X] → Union[X, None] 和字面量
    origin = getattr(py_type, '__origin__', None)
    args = getattr(py_type, '__args__', [])

    if origin is list or origin is List:
        items_type = _py_type_to_schema(args[0]) if args else {}
        return {"type": "array", "items": items_type}
    if origin is dict or origin is Dict:
        return {"type": "object"}
    if origin is Union:  # noqa
        non_none = [a for a in args if a is not type(None)]
        if non_none:
            return _py_type_to_schema(non_none[0])

    schema_type = _TYPE_MAP.get(py_type, "string")
    schema = {"type": schema_type}

    if default is not None:
        schema["default"] = default

    return schema


def _func_name_to_tool_name(func_name: str) -> str:
    """将 snake_case 函数名转为 kebab-case 工具名"""
    return func_name.replace("_", "-")


class FastMCP:
    """轻量级 MCP 服务器，模拟官方 FastMCP API"""

    def __init__(self, name: str, version: str = "0.1.0"):
        self.name = name
        self.version = version
        self._tools: List[Dict] = []
        self._handlers: Dict[str, Callable] = {}

    def tool(self, name: str = None):
        """
        装饰器：注册一个 MCP 工具
        从函数签名自动生成 inputSchema
        """
        def decorator(func: Callable):
            tool_name = name or _func_name_to_tool_name(func.__name__)

            # 解析函数签名
            sig = inspect.signature(func)
            properties = {}
            required = []

            for param_name, param in sig.parameters.items():
                if param_name == 'self':
                    continue
                # 获取类型注解
                py_type = func.__annotations__.get(param_name, str)
                # 处理没有默认值的参数 -> 传给 schema 的是 None 而不是 sentinel
                default_val = None if param.default is inspect.Parameter.empty else param.default
                schema = _py_type_to_schema(py_type, default_val)

                # 如果有文档字符串中的参数说明，提取 description
                schema["description"] = param_name

                properties[param_name] = schema

                # 没有默认值的参数为 required
                if param.default is inspect.Parameter.empty:
                    required.append(param_name)

            # 工具定义
            tool_def = {
                "name": tool_name,
                "description": (func.__doc__ or "").strip(),
                "inputSchema": {
                    "type": "object",
                    "properties": properties,
                    "required": required
                }
            }

            self._tools.append(tool_def)
            self._handlers[tool_name] = func
            logger.debug(f"注册工具: {tool_name}")
            return func

        return decorator

    # ---- MCP 协议处理 ----

    def _handle_initialize(self, params: dict) -> dict:
        return {
            "protocolVersion": params.get("protocolVersion", "2024-11-05"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": self.name, "version": self.version},
        }

    def _handle_list_tools(self) -> dict:
        return {"tools": self._tools}

    async def _handle_call_tool(self, name: str, arguments: dict) -> dict:
        handler = self._handlers.get(name)
        if not handler:
            return {"content": [{"type": "text", "text": f"未知工具: {name}"}], "isError": True}

        try:
            result = handler(**arguments)
            # 如果是协程函数，等待结果
            if inspect.iscoroutine(result):
                result = await result
            return {"content": [{"type": "text", "text": str(result)}]}
        except Exception as e:
            logger.error(f"工具 {name} 执行失败: {e}")
            return {"content": [{"type": "text", "text": f"执行错误: {e}"}], "isError": True}

    async def _dispatch(self, msg: dict) -> Optional[str]:
        """分发 JSON-RPC 消息（带超时保护）"""
        method = msg.get("method")
        msg_id = msg.get("id")
        params = msg.get("params", {})

        # 通知类消息无需响应
        if msg_id is None:
            return None

        try:
            if method == "initialize":
                return self._json_response(msg_id, self._handle_initialize(params))
            elif method == "tools/list":
                return self._json_response(msg_id, self._handle_list_tools())
            elif method == "tools/call":
                # 给工具调用加超时保护，防止一个慢操作卡死整个 MCP 进程
                result = await asyncio.wait_for(
                    self._handle_call_tool(
                        params.get("name", ""), params.get("arguments", {})
                    ),
                    timeout=120  # 单次工具调用最多 120 秒
                )
                return self._json_response(msg_id, result)
            elif method == "notifications/initialized":
                return None
            else:
                return self._json_response(msg_id, error={
                    "code": -32601, "message": f"方法 '{method}' 未实现"
                })
        except asyncio.TimeoutError:
            logger.error(f"工具调用超时: {params.get('name', '')}")
            return self._json_response(msg_id, error={
                "code": -32603, "message": f"工具 '{params.get('name', '')}' 执行超时"
            })

    def _json_response(self, msg_id: Any, result: Any = None,
                       error: Optional[Dict] = None) -> str:
        msg = {"jsonrpc": "2.0", "id": msg_id}
        if error:
            msg["error"] = error
        else:
            msg["result"] = result
        return json.dumps(msg, ensure_ascii=False)

    # ---- 运行 ----

    def run(self, transport: str = "stdio"):
        """启动 MCP Server"""
        if transport != "stdio":
            raise ValueError(f"不支持的传输方式: {transport}，仅支持 stdio")

        logger.info(f"MCP Server '{self.name}' 启动...")
        self._run_stdio()

    def _run_stdio(self):
        """运行 stdio 模式主循环"""
        if sys.platform == "win32":
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            sys.stdin.reconfigure(encoding='utf-8', errors='replace')

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(self._async_stdio_loop())

    async def _async_stdio_loop(self):
        """异步 stdio 主循环（Windows 兼容）"""
        async def read_line() -> str:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, sys.stdin.readline)

        logger.info("等待 MCP 客户端连接 (stdin/stdout)")

        while True:
            try:
                raw = await read_line()
                if not raw:
                    logger.info("客户端断开")
                    break
                raw = raw.strip()
                if not raw:
                    continue

                msg = json.loads(raw)
                response = await self._dispatch(msg)
                if response:
                    print(response, flush=True)

            except json.JSONDecodeError:
                continue
            except (EOFError, asyncio.CancelledError):
                break
            except Exception as e:
                logger.error(f"错误: {e}")
                try:
                    err = json.dumps({"jsonrpc": "2.0", "id": None,
                                      "error": {"code": -32603, "message": str(e)}})
                    print(err, flush=True)
                except Exception:
                    pass
