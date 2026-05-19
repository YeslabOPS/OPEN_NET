"""设备管理 API 路由"""
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from tools.device_store import device_store
from tools.ssh_tool import ssh_pool

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/devices", tags=["Devices"])


class DeviceCreate(BaseModel):
    name: str = Field(..., description="设备名称")
    host: str = Field(..., description="设备 IP 或主机名")
    port: int = Field(22, description="SSH 端口")
    username: str = Field("", description="登录用户名")
    password: str = Field("", description="登录密码")
    key_path: str = Field("", description="密钥文件路径")
    device_type: str = Field("router", description="设备类型")
    description: str = Field("", description="设备描述")


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    key_path: Optional[str] = None
    device_type: Optional[str] = None
    description: Optional[str] = None


class SSHTestRequest(BaseModel):
    host: str = Field(..., description="设备 IP")
    port: int = Field(22, description="SSH 端口")
    username: str = Field(..., description="用户名")
    password: str = Field("", description="密码")
    key_path: str = Field("", description="密钥路径")


@router.get("")
async def list_devices():
    """列出所有设备"""
    return device_store.list()


@router.post("")
async def add_device(device: DeviceCreate):
    """添加设备"""
    return device_store.add(device.model_dump())


@router.get("/{device_id}")
async def get_device(device_id: str):
    """获取设备详情"""
    device = device_store.get(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.put("/{device_id}")
async def update_device(device_id: str, updates: DeviceUpdate):
    """更新设备"""
    # 过滤掉 None 值
    update_data = {k: v for k, v in updates.model_dump().items() if v is not None}
    device = device_store.update(device_id, update_data)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.delete("/{device_id}")
async def delete_device(device_id: str):
    """删除设备"""
    success = device_store.delete(device_id)
    if not success:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"status": "deleted"}


@router.post("/test")
async def test_connection(request: SSHTestRequest):
    """测试 SSH 连接"""
    import asyncio
    try:
        key = request.key_path if request.key_path else None
        conn = ssh_pool.create(
            request.host, request.port, request.username,
            request.password, key,
        )
        await conn.connect()
        await ssh_pool.remove(conn.connection_id)
        return {"status": "success", "message": "SSH 连接测试成功"}
    except Exception as e:
        return {"status": "failed", "message": f"连接失败: {str(e)}"}


@router.get("/tools/list")
async def list_ssh_tools():
    """列出 SSH 连接状态"""
    return {
        "connections": ssh_pool.list(),
        "tools": ["ssh_connect", "ssh_execute", "ssh_disconnect", "list_connections"],
    }
