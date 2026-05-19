"""Agent 可调用的 SSH 工具封装"""
import json
import logging
from .ssh_tool import ssh_pool
from .mcp_server import mcp_server

logger = logging.getLogger(__name__)


async def ssh_connect_tool(host: str, port: int = 22, username: str = "",
                           password: str = "", key_path: str = "") -> str:
    """建立 SSH 连接
    
    Args:
        host: 主机地址
        port: SSH 端口
        username: 用户名
        password: 密码
        key_path: 密钥文件路径（可选）
        
    Returns:
        连接结果
    """
    try:
        key = key_path if key_path else None
        conn = ssh_pool.create(host, port, username, password, key)
        await conn.connect()
        return f"SSH 连接成功: {username}@{host}:{port} (连接ID: {conn.connection_id})"
    except Exception as e:
        return f"SSH 连接失败: {str(e)}"


async def ssh_execute_tool(connection_id: str, command: str) -> str:
    """在远程设备上执行命令
    
    Args:
        connection_id: 连接 ID
        command: 要执行的命令
        
    Returns:
        命令执行结果
    """
    conn = ssh_pool.get(connection_id)
    if not conn:
        return f"连接不存在: {connection_id}"
    
    try:
        result = await conn.execute(command)
        
        output_parts = []
        output_parts.append(f"命令: {command}")
        output_parts.append(f"退出码: {result['exit_code']}")
        
        if result['stdout'].strip():
            output_parts.append(f"输出:\n{result['stdout'].strip()}")
        if result['stderr'].strip():
            output_parts.append(f"错误:\n{result['stderr'].strip()}")
        
        return "\n".join(output_parts)
    except Exception as e:
        return f"命令执行失败: {str(e)}"


async def ssh_disconnect_tool(connection_id: str) -> str:
    """断开 SSH 连接
    
    Args:
        connection_id: 连接 ID
        
    Returns:
        断开结果
    """
    await ssh_pool.remove(connection_id)
    return f"连接已断开: {connection_id}"


async def list_connections_tool() -> str:
    """列出所有 SSH 连接
    
    Returns:
        连接列表
    """
    connections = ssh_pool.list()
    if not connections:
        return "当前没有活跃的 SSH 连接"
    
    lines = ["活跃的 SSH 连接：\n"]
    for c in connections:
        status = "✅" if c["connected"] else "❌"
        lines.append(f"- {status} {c['host']}:{c['port']} ({c['username']}) [{c['connection_id'][:8]}...]")
    
    return "\n".join(lines)


def register_all_ssh_tools():
    """注册所有 SSH 工具到 MCP Server"""
    mcp_server.register_tool(
        name="ssh_connect",
        description="建立 SSH 连接到远程网络设备",
        parameters={
            "type": "object",
            "properties": {
                "host": {"type": "string", "description": "设备 IP 或主机名"},
                "port": {"type": "integer", "description": "SSH 端口", "default": 22},
                "username": {"type": "string", "description": "登录用户名"},
                "password": {"type": "string", "description": "登录密码"},
                "key_path": {"type": "string", "description": "密钥文件路径（可选）"},
            },
            "required": ["host", "username"],
        },
        handler=ssh_connect_tool,
    )
    
    mcp_server.register_tool(
        name="ssh_execute",
        description="在已连接的设备上执行命令",
        parameters={
            "type": "object",
            "properties": {
                "connection_id": {"type": "string", "description": "连接 ID"},
                "command": {"type": "string", "description": "要执行的命令"},
            },
            "required": ["connection_id", "command"],
        },
        handler=ssh_execute_tool,
    )
    
    mcp_server.register_tool(
        name="ssh_disconnect",
        description="断开 SSH 连接",
        parameters={
            "type": "object",
            "properties": {
                "connection_id": {"type": "string", "description": "连接 ID"},
            },
            "required": ["connection_id"],
        },
        handler=ssh_disconnect_tool,
    )
    
    mcp_server.register_tool(
        name="list_connections",
        description="列出所有活跃的 SSH 连接",
        parameters={
            "type": "object",
            "properties": {},
        },
        handler=list_connections_tool,
    )
    
    logger.info("All SSH tools registered to MCP Server")


# 注册工具
register_all_ssh_tools()
