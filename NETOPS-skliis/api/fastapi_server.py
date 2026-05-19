"""
FastAPI 常驻服务 - 替代每次 API 调用都 exec 新 Python 进程的方式
性能提升: 消除 Python 启动开销 (~1-2 秒/请求)，冷启动首次 ~3 秒，后续请求 <10ms
"""
import sys
import os
import json
import asyncio
from typing import Optional, List
from contextlib import asynccontextmanager

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ========== 导入底层模块 ==========
from core.device_loader import load_devices
from core.backup import BackupEngine
from core.inspector import Inspector
from core.ssh_client import SSHClient, SSHClientError
from core.checker import ConnectivityChecker
from core.differ import ConfigDiffer
from ensp_parser import load_topo, load_topo_from_str

# ========== 调度器 ==========
from api.scheduler import SchedulerManager

scheduler_manager: Optional[SchedulerManager] = None

# 常量
TEMPLATE_FILE = os.path.join(PROJECT_ROOT, "config", "inspect_templates.json")
DEVICES_YAML = os.path.join(PROJECT_ROOT, "config", "devices.yaml")

# ========== Pydantic 模型 ==========

class DeviceAddParams(BaseModel):
    name: str
    host: str
    port: int = 22
    username: str = ""
    password: str = ""
    device_type: str = "huawei"
    secret: str = ""
    description: str = ""
    protocol: str = "ssh"

class DeviceUpdateParams(BaseModel):
    host: str
    port: Optional[int] = None
    name: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    device_type: Optional[str] = None
    secret: Optional[str] = None
    description: Optional[str] = None
    protocol: Optional[str] = None

class SshExecuteParams(BaseModel):
    host: str
    username: str = ""
    password: str = ""
    device_type: str = "huawei"
    command: str = "display version"
    port: Optional[int] = None
    protocol: Optional[str] = None

class SshBatchParams(BaseModel):
    host: str
    username: str = ""
    password: str = ""
    device_type: str = "huawei"
    commands: List[str]
    port: Optional[int] = None
    protocol: Optional[str] = None

class PingParams(BaseModel):
    target: str

class PortCheckParams(BaseModel):
    target: str
    port: int = 22

class DiffParams(BaseModel):
    old_file: str
    new_file: str

class ScheduleAddParams(BaseModel):
    name: str
    type: str  # backup_all, inspect_all, backup_device, inspect_device
    trigger_type: str = "date"  # "date" or "duration"
    run_at: Optional[str] = None  # ISO datetime, e.g. "2026-05-11T18:56:32"
    delay_seconds: int = 0  # for duration trigger
    device_name: str = ""
    enabled: bool = True

class ScheduleUpdateParams(BaseModel):
    id: str
    name: Optional[str] = None
    type: Optional[str] = None
    trigger_type: Optional[str] = None
    run_at: Optional[str] = None
    delay_seconds: Optional[int] = None
    device_name: Optional[str] = None
    enabled: Optional[bool] = None

# ========== 辅助函数 ==========

def _run_sync(callable):
    """在后台线程中运行同步函数（避免阻塞 FastAPI 事件循环）"""
    import concurrent.futures
    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor() as pool:
        return loop.run_in_executor(pool, callable)

async def _load_yaml_devices():
    """加载 YAML 设备列表"""
    return load_devices()

def _get_device_credential(host: str, port: int = 0):
    """获取设备完整凭证"""
    import yaml
    with open(DEVICES_YAML, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    devices = data.get("devices", [])
    for d in devices:
        if d.get("host") == host and (not port or d.get("port") == port):
            return d
    return None

# ========== Lifespan ==========

@asynccontextmanager
async def lifespan(app: FastAPI):
    global scheduler_manager
    scheduler_manager = SchedulerManager()
    scheduler_manager.start()
    print("[FastAPI] 调度器已启动")
    yield
    scheduler_manager.stop()
    print("[FastAPI] 调度器已停止")

app = FastAPI(title="NetOps Python Backend", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# ========== 健康检查 ==========

@app.get("/api/health")
async def health():
    return {"success": True, "data": {"status": "ok", "service": "netops-python-backend"}}

# ========== 设备 CRUD ==========

@app.get("/api/devices/list")
async def api_device_list():
    devices = await _run_sync(load_devices)
    safe = []
    for d in devices:
        safe.append({
            "name": d.get("name", ""),
            "host": d.get("host", ""),
            "port": d.get("port", 22),
            "username": d.get("username", ""),
            "device_type": d.get("device_type", ""),
            "description": d.get("description", ""),
            "protocol": d.get("protocol", ""),
        })
    return {"success": True, "data": safe}

@app.post("/api/devices/add")
async def api_device_add(params: DeviceAddParams):
    import yaml
    try:
        with open(DEVICES_YAML, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        devices = data.get("devices", [])
        for d in devices:
            if d.get("host") == params.host and d.get("port") == params.port:
                return {"success": False, "error": f"设备 {params.host}:{params.port} 已存在"}
        new_dev = {"name": params.name, "host": params.host, "port": params.port,
                   "device_type": params.device_type, "protocol": params.protocol}
        if params.protocol != "telnet":
            if not params.username:
                return {"success": False, "error": "SSH 设备需要填写用户名"}
            if not params.password:
                return {"success": False, "error": "SSH 设备需要填写密码"}
            new_dev["username"] = params.username
            new_dev["password"] = params.password
        else:
            if params.username: new_dev["username"] = params.username
            if params.password: new_dev["password"] = params.password
        if params.secret: new_dev["secret"] = params.secret
        if params.description: new_dev["description"] = params.description
        devices.append(new_dev)
        data["devices"] = devices
        if "global_settings" not in data:
            data["global_settings"] = {"timeout": 30, "verbose": True}
        with open(DEVICES_YAML, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False)
        return {"success": True, "data": "设备添加成功"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.put("/api/devices/update")
async def api_device_update(params: DeviceUpdateParams):
    import yaml
    try:
        with open(DEVICES_YAML, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        devices = data.get("devices", [])
        found = False
        for d in devices:
            if d.get("host") == params.host and (params.port is None or d.get("port") == params.port):
                if params.name: d["name"] = params.name
                if params.port is not None: d["port"] = params.port
                if params.username is not None: d["username"] = params.username
                if params.password is not None: d["password"] = params.password
                if params.device_type: d["device_type"] = params.device_type
                if params.secret is not None: d["secret"] = params.secret
                if params.description is not None: d["description"] = params.description
                if params.protocol: d["protocol"] = params.protocol
                found = True
                break
        if not found:
            return {"success": False, "error": f"设备 {params.host} 不存在"}
        with open(DEVICES_YAML, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False)
        return {"success": True, "data": "设备更新成功"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.delete("/api/devices/delete")
async def api_device_delete(host: str = Query(...), port: int = Query(0)):
    import yaml
    try:
        with open(DEVICES_YAML, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        devices = data.get("devices", [])
        new_devices = [d for d in devices if not (d.get("host") == host and (not port or d.get("port") == port))]
        if len(new_devices) == len(devices):
            return {"success": False, "error": f"设备 {host} 不存在"}
        data["devices"] = new_devices
        with open(DEVICES_YAML, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False)
        return {"success": True, "data": "设备删除成功"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/api/devices/credentials")
async def api_device_credentials(host: str = Query(...), port: int = Query(0)):
    dev = _get_device_credential(host, port)
    if not dev:
        return {"success": False, "error": f"设备 {host}:{port} 不存在"}
    return {"success": True, "data": dev}

# ========== 备份 ==========

@app.post("/api/backup/run")
async def api_backup_run():
    from core.device_loader import load_devices
    from core.backup import BackupEngine
    devices = load_devices()
    engine = BackupEngine()
    engine.backup_all(devices)
    engine.generate_report_file()
    results = [r.to_dict() for r in engine.results]
    return {"success": True, "data": results}

@app.post("/api/backup/run/{host}")
async def api_backup_run_device(host: str):
    from core.device_loader import load_devices
    from core.backup import BackupEngine
    devices = load_devices()
    device = next((d for d in devices if d.get("host") == host or d.get("name") == host), None)
    if not device:
        return {"success": False, "error": f"设备 {host} 未找到"}
    engine = BackupEngine()
    result = engine.backup_device(device)
    return {"success": True, "data": result.to_dict()}

@app.get("/api/backup/list")
async def api_backup_list():
    engine = BackupEngine()
    files = engine.list_backups()
    data = [{"filename": f, "size": os.path.getsize(os.path.join(engine.backup_dir, f)),
             "path": os.path.join(engine.backup_dir, f)} for f in files]
    return {"success": True, "data": data}

@app.get("/api/backup/content/{filename:path}")
async def api_backup_content(filename: str):
    engine = BackupEngine()
    filepath = os.path.join(engine.backup_dir, filename)
    if not os.path.exists(filepath):
        return {"success": False, "error": f"文件不存在: {filename}"}
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    return {"success": True, "data": content}

@app.delete("/api/backup/{filename:path}")
async def api_backup_delete(filename: str):
    engine = BackupEngine()
    filepath = os.path.join(engine.backup_dir, filename)
    if not os.path.exists(filepath):
        return {"success": False, "error": f"文件不存在: {filename}"}
    os.remove(filepath)
    baselines_file = os.path.join(PROJECT_ROOT, "config", ".baselines.json")
    if os.path.exists(baselines_file):
        try:
            with open(baselines_file, "r") as f:
                bl = json.load(f)
            bl_list = bl.get("baselines", [])
            if filename in bl_list:
                bl_list.remove(filename)
                bl["baselines"] = bl_list
                with open(baselines_file, "w") as f:
                    json.dump(bl, f, indent=2)
        except Exception:
            pass
    return {"success": True, "data": f"已删除: {filename}"}

# 基线管理
class BaselineParams(BaseModel):
    filename: str = ""
    action: str = "add"  # add, clear

@app.post("/api/backup/baseline")
async def api_backup_baseline(params: BaselineParams):
    baselines_file = os.path.join(PROJECT_ROOT, "config", ".baselines.json")
    try:
        if os.path.exists(baselines_file):
            with open(baselines_file, "r") as f:
                bl = json.load(f)
        else:
            bl = {}
        bl_list = bl.get("baselines", [])
        if params.action == "clear":
            if params.filename and params.filename in bl_list:
                bl_list.remove(params.filename)
            elif not params.filename:
                bl_list = []
            else:
                return {"success": False, "error": f"基线 {params.filename} 不存在"}
            if bl_list:
                bl["baselines"] = bl_list
                with open(baselines_file, "w") as f:
                    json.dump(bl, f, indent=2)
            else:
                os.remove(baselines_file)
            return {"success": True, "data": "基线已清除"}
        else:
            if params.filename not in bl_list:
                bl_list.append(params.filename)
            bl["baselines"] = bl_list
            with open(baselines_file, "w") as f:
                json.dump(bl, f, indent=2)
            return {"success": True, "data": f"基线已添加: {params.filename}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/api/backup/baseline")
async def api_backup_get_baseline():
    baselines_file = os.path.join(PROJECT_ROOT, "config", ".baselines.json")
    if not os.path.exists(baselines_file):
        return {"success": True, "data": []}
    with open(baselines_file, "r") as f:
        bl = json.load(f)
    return {"success": True, "data": bl.get("baselines", [])}

# ========== SSH 交互 ==========

@app.post("/api/ssh/execute")
async def api_ssh_execute(params: SshExecuteParams):
    # 查询完整凭证
    if params.host:
        dev = _get_device_credential(params.host, params.port or 0)
        if dev:
            username = params.username or dev.get("username", "admin")
            password = params.password or dev.get("password", "")
            device_type = params.device_type or dev.get("device_type", "huawei")
            protocol = params.protocol or dev.get("protocol", "")
            port = params.port or dev.get("port", 22)
        else:
            username = params.username or "admin"
            password = params.password or ""
            device_type = params.device_type or "huawei"
            protocol = params.protocol or ""
            port = params.port or 22
    else:
        return {"success": False, "error": "缺少 host 参数"}
    device = {"host": params.host, "username": username, "password": password,
              "device_type": device_type, "name": params.host, "port": port}
    if protocol:
        device["protocol"] = protocol
    try:
        client = SSHClient(device)
        client.connect()
        # ["修复"] 单命令也使用视图感知执行
        output = client.send_commands_with_views([params.command])
        client.disconnect()
        return {"success": True, "data": output}
    except SSHClientError as e:
        return {"success": False, "error": str(e)}

@app.post("/api/ssh/batch")
async def api_ssh_batch(params: SshBatchParams):
    if params.host:
        dev = _get_device_credential(params.host, params.port or 0)
        if dev:
            username = params.username or dev.get("username", "admin")
            password = params.password or dev.get("password", "")
            device_type = params.device_type or dev.get("device_type", "huawei")
            protocol = params.protocol or dev.get("protocol", "")
            port = params.port or dev.get("port", 22)
        else:
            username = params.username or "admin"
            password = params.password or ""
            device_type = params.device_type or "huawei"
            protocol = params.protocol or ""
            port = params.port or 22
    else:
        return {"success": False, "error": "缺少 host 参数"}
    device = {"host": params.host, "username": username, "password": password,
              "device_type": device_type, "name": params.host, "port": port}
    if protocol:
        device["protocol"] = protocol
    try:
        client = SSHClient(device)
        client.connect()
        output = client.send_commands_with_views(params.commands)
        client.disconnect()
        return {"success": True, "data": output}
    except SSHClientError as e:
        return {"success": False, "error": str(e)}

# ========== 连通性检测 ==========

@app.post("/api/check/ping")
async def api_ping(params: PingParams):
    checker = ConnectivityChecker(verbose=False)
    result = checker.ping(params.target, count=2)
    return {"success": True, "data": {"target": result.target, "reachable": result.success,
                                       "rtt_ms": result.rtt_ms, "packet_loss": result.packet_loss}}

@app.post("/api/check/port")
async def api_port_check(params: PortCheckParams):
    checker = ConnectivityChecker(verbose=False)
    result = checker.check_tcp_port(params.target, params.port, timeout=5)
    return {"success": True, "data": {"target": result.target, "port": result.port,
                                       "open": result.success, "rtt_ms": result.rtt_ms}}

# ========== 配置对比 ==========

@app.post("/api/diff/compare")
async def api_diff_compare(params: DiffParams):
    differ = ConfigDiffer()
    result = differ.compare_files(params.old_file, params.new_file)
    if result.error_message:
        return {"success": False, "error": result.error_message}
    return {"success": True, "data": {"old_name": result.old_name, "new_name": result.new_name,
                                       "added": result.added_lines, "removed": result.removed_lines,
                                       "changed_blocks": result.changed_lines,
                                       "has_changes": result.has_changes, "diff": result.diff_lines}}

@app.get("/api/diff/list")
async def api_diff_list():
    import glob
    differ = ConfigDiffer()
    report_dir = differ.backup_engine.backup_dir
    reports = sorted(glob.glob(os.path.join(report_dir, "diff_report_*.txt")), reverse=True)
    data = [{"filename": os.path.basename(rp), "size": os.path.getsize(rp), "path": rp} for rp in reports]
    return {"success": True, "data": data}

# ========== 巡检 ==========

@app.post("/api/inspect/run")
async def api_inspect_run():
    from core.device_loader import load_devices
    from core.inspector import Inspector
    devices = load_devices()
    inspector = Inspector(template_file=TEMPLATE_FILE)
    inspector.inspect_all(devices)
    results = [r.to_dict() for r in inspector.results]
    return {"success": True, "data": results}

@app.post("/api/inspect/run/{host}")
async def api_inspect_run_device(host: str):
    from core.device_loader import load_devices
    from core.inspector import Inspector
    devices = load_devices()
    device = next((d for d in devices if d.get("host") == host or d.get("name") == host), None)
    if not device:
        return {"success": False, "error": f"设备 {host} 未找到"}
    inspector = Inspector(template_file=TEMPLATE_FILE)
    inspector.inspect_all([device])
    results = [r.to_dict() for r in inspector.results]
    return {"success": True, "data": results}

@app.get("/api/inspect/list")
async def api_inspect_list():
    import glob
    from core.inspector import Inspector
    insp = Inspector()
    reports = sorted(glob.glob(os.path.join(insp.output_dir, "inspect_report_*.txt")), reverse=True)
    data = [{"filename": os.path.basename(rp), "size": os.path.getsize(rp), "path": rp} for rp in reports]
    return {"success": True, "data": data}

@app.delete("/api/inspect/{filename:path}")
async def api_inspect_delete(filename: str):
    from core.inspector import Inspector
    insp = Inspector()
    filepath = os.path.join(insp.output_dir, filename)
    if not os.path.exists(filepath):
        return {"success": False, "error": f"文件不存在: {filename}"}
    os.remove(filepath)
    return {"success": True, "data": f"已删除: {filename}"}

# 巡检模板管理
class InspectTemplateParams(BaseModel):
    commands: str = ""

@app.get("/api/inspect/template")
async def api_inspect_template_get():
    if os.path.exists(TEMPLATE_FILE):
        try:
            with open(TEMPLATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {"success": True, "data": data.get("commands", "")}
        except Exception:
            pass
    return {"success": True, "data": ""}

@app.put("/api/inspect/template")
async def api_inspect_template_set(params: InspectTemplateParams):
    if not params.commands:
        return {"success": False, "error": "缺少命令"}
    try:
        os.makedirs(os.path.dirname(TEMPLATE_FILE), exist_ok=True)
        with open(TEMPLATE_FILE, "w", encoding="utf-8") as f:
            json.dump({"commands": params.commands}, f, indent=2, ensure_ascii=False)
        return {"success": True, "data": "模板已保存"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.delete("/api/inspect/template")
async def api_inspect_template_delete():
    if os.path.exists(TEMPLATE_FILE):
        os.remove(TEMPLATE_FILE)
    return {"success": True, "data": "模板已清除"}

# ========== 文件读取 ==========

@app.get("/api/file/read")
async def api_file_read(path: str = Query(...)):
    if not os.path.exists(path):
        return {"success": False, "error": f"文件不存在: {path}"}
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    return {"success": True, "data": content}

# ========== eNSP 拓扑 ==========

TOPO_CACHE_FILE = os.path.join(PROJECT_ROOT, "topos", ".topo_cache.json")

def _save_topo_cache(data: dict, filepath: str):
    cache = {"filepath": filepath, "topology": data}
    os.makedirs(os.path.dirname(TOPO_CACHE_FILE), exist_ok=True)
    with open(TOPO_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)

def _load_topo_cache():
    if not os.path.exists(TOPO_CACHE_FILE):
        return None, None
    try:
        with open(TOPO_CACHE_FILE, "r", encoding="utf-8") as f:
            cache = json.load(f)
        return cache.get("topology"), cache.get("filepath", "")
    except (json.JSONDecodeError, IOError):
        return None, None

@app.post("/api/topo/load")
async def api_topo_load(filepath: str = Query(...)):
    result = load_topo(filepath)
    if result.get("success"):
        _save_topo_cache(result["data"], filepath)
    return result

@app.get("/api/topo/info")
async def api_topo_info():
    topology, filepath = _load_topo_cache()
    if not topology:
        return {"success": False, "error": "未加载拓扑，请先上传 .topo 文件"}
    return {"success": True, "data": topology}

@app.get("/api/topo/devices")
async def api_topo_devices():
    topology, filepath = _load_topo_cache()
    if not topology:
        return {"success": False, "error": "未加载拓扑"}
    devices = topology.get("devices", [])
    return {"success": True, "data": [{
        "name": d["name"], "model": d["model"], "device_type": d["device_type"],
        "is_configurable": d["is_configurable"], "com_port": d["com_port"],
        "interfaces": d["interfaces"], "position": d.get("position", {}),
    } for d in devices]}

@app.delete("/api/topo/clear")
async def api_topo_clear():
    if os.path.exists(TOPO_CACHE_FILE):
        try:
            os.remove(TOPO_CACHE_FILE)
        except OSError:
            pass
    return {"success": True, "data": "拓扑缓存已清除"}

# ========== 调度管理 ==========

@app.get("/api/schedule/list")
async def api_schedule_list():
    if scheduler_manager is None:
        return {"success": False, "error": "调度器未初始化"}
    schedules = scheduler_manager.get_all_schedules()
    return {"success": True, "data": schedules}

@app.post("/api/schedule/add")
async def api_schedule_add(params: ScheduleAddParams):
    if scheduler_manager is None:
        return {"success": False, "error": "调度器未初始化"}
    try:
        schedule = scheduler_manager.add_schedule(
            name=params.name,
            schedule_type=params.type,
            trigger_type=params.trigger_type,
            run_at=params.run_at,
            delay_seconds=params.delay_seconds,
            device_name=params.device_name,
            enabled=params.enabled,
        )
        return {"success": True, "data": schedule}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/api/schedule/update")
async def api_schedule_update(params: ScheduleUpdateParams):
    if scheduler_manager is None:
        return {"success": False, "error": "调度器未初始化"}
    try:
        result = scheduler_manager.update_schedule(params.id, {
            "name": params.name, "type": params.type,
            "trigger_type": params.trigger_type,
            "run_at": params.run_at,
            "delay_seconds": params.delay_seconds,
            "device_name": params.device_name, "enabled": params.enabled,
        })
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/api/schedule/delete")
async def api_schedule_delete(id: str = Query(...)):
    if scheduler_manager is None:
        return {"success": False, "error": "调度器未初始化"}
    scheduler_manager.remove_schedule(id)
    return {"success": True, "data": f"调度任务 {id} 已删除"}

@app.post("/api/schedule/trigger")
async def api_schedule_trigger(id: str = Query(...)):
    if scheduler_manager is None:
        return {"success": False, "error": "调度器未初始化"}
    try:
        scheduler_manager.trigger_schedule(id)
        return {"success": True, "data": f"调度任务 {id} 已触发"}
    except Exception as e:
        return {"success": False, "error": str(e)}

# ========== 启动入口 ==========

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("FASTAPI_PORT", "3002"))
    print(f"[FastAPI] 启动服务于 127.0.0.1:{port}")
    uvicorn.run("api.fastapi_server:app", host="127.0.0.1", port=port, log_level="info")
