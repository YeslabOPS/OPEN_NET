"""
后端 API Runner - 供 Node.js Express 后端调用
所有命令输出 JSON 格式结果
"""

import sys
import os
import json
import io as io_module
import base64

API_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(API_DIR)
sys.path.insert(0, PROJECT_ROOT)


def _capture(func, *args, **kwargs):
    """执行函数并捕获 stdout 输出"""
    old = sys.stdout
    sys.stdout = io_module.StringIO()
    try:
        ret = func(*args, **kwargs)
    finally:
        sys.stdout = old
    return ret


# ========== 设备管理 CRUD ==========

DEVICES_YAML = os.path.join(PROJECT_ROOT, "config", "devices.yaml")


def _read_yaml_raw():
    """读取 YAML 内容为字符串（不解析）"""
    with open(DEVICES_YAML, "r", encoding="utf-8") as f:
        return f.read()


def _write_yaml(content: str):
    with open(DEVICES_YAML, "w", encoding="utf-8") as f:
        f.write(content)


def device_list():
    """返回设备列表（已清洗敏感字段，不返回密码和secret）"""
    from core.device_loader import load_devices
    devices = load_devices()
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
    return json.dumps({"success": True, "data": safe})


def device_add(name, host, port, username, password, device_type, secret="", description="", protocol="ssh"):
    """添加设备到 YAML（Telnet 设备可不填 username/password）"""
    try:
        import yaml
        with open(DEVICES_YAML, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        devices = data.get("devices", [])
        # 检查重复（IP:端口联合唯一）
        for d in devices:
            if d.get("host") == host and d.get("port") == int(port):
                return json.dumps({"success": False, "error": f"设备 {host}:{port} 已存在"})
        new_dev = {
            "name": name,
            "host": host,
            "port": int(port),
            "device_type": device_type,
            "protocol": protocol,
        }
        # Telnet 免账密，SSH 需要用户名密码
        if protocol != "telnet":
            if not username:
                return json.dumps({"success": False, "error": "SSH 设备需要填写用户名"})
            if not password:
                return json.dumps({"success": False, "error": "SSH 设备需要填写密码"})
            new_dev["username"] = username
            new_dev["password"] = password
        else:
            if username:
                new_dev["username"] = username
            if password:
                new_dev["password"] = password
        if secret:
            new_dev["secret"] = secret
        if description:
            new_dev["description"] = description
        devices.append(new_dev)
        data["devices"] = devices
        if "global_settings" not in data:
            data["global_settings"] = {"timeout": 30, "verbose": True}
        with open(DEVICES_YAML, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False)
        return json.dumps({"success": True, "data": "设备添加成功"})
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


def device_update(host, name=None, port=None, username=None, password=None,
                  device_type=None, secret=None, description=None, protocol=None):
    """更新设备信息（按 host:port 匹配合）"""
    try:
        import yaml
        with open(DEVICES_YAML, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        devices = data.get("devices", [])
        found = False
        # 按 host:port 联合匹配
        try:
            orig_port = int(port) if port and str(port).isdigit() else None
        except (ValueError, TypeError):
            orig_port = None
        for d in devices:
            if d.get("host") == host and (orig_port is None or d.get("port") == orig_port):
                if name: d["name"] = name
                if port: d["port"] = int(port)
                # Telnet 可选更新 username/password
                if username is not None: d["username"] = username
                if password is not None: d["password"] = password
                if device_type: d["device_type"] = device_type
                if secret is not None: d["secret"] = secret
                if description is not None: d["description"] = description
                if protocol: d["protocol"] = protocol
                found = True
                break
        if not found:
            return json.dumps({"success": False, "error": f"设备 {host}:{port} 不存在"})
        with open(DEVICES_YAML, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False)
        return json.dumps({"success": True, "data": "设备更新成功"})
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})



def device_get_credentials(host, port=0):
    """获取指定设备的完整凭证（按 host:port 匹配）"""
    import yaml
    try:
        with open(DEVICES_YAML, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        devices = data.get("devices", [])
        try:
            orig_port = int(port) if port and str(port).isdigit() else 0
        except (ValueError, TypeError):
            orig_port = 0
        for d in devices:
            if d.get("host") == host and (not orig_port or d.get("port") == orig_port):
                return json.dumps({"success": True, "data": {
                    "host": d.get("host", ""),
                    "username": d.get("username", ""),
                    "password": d.get("password", ""),
                    "secret": d.get("secret", ""),
                    "device_type": d.get("device_type", ""),
                    "port": d.get("port", 22),
                    "name": d.get("name", ""),
                    "protocol": d.get("protocol", ""),
                }})
        return json.dumps({"success": False, "error": f"设备 {host}:{port} 不存在"})
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


def device_delete(host, port=0):
    """删除设备（按 host:port 匹配）"""
    try:
        import yaml
        with open(DEVICES_YAML, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        devices = data.get("devices", [])
        try:
            orig_port = int(port) if port and str(port).isdigit() else 0
        except (ValueError, TypeError):
            orig_port = 0
        new_devices = [
            d for d in devices
            if not (d.get("host") == host and (not orig_port or d.get("port") == orig_port))
        ]
        if len(new_devices) == len(devices):
            return json.dumps({"success": False, "error": f"设备 {host}:{port} 不存在"})
        data["devices"] = new_devices
        with open(DEVICES_YAML, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False)
        return json.dumps({"success": True, "data": "设备删除成功"})
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


# ========== 备份管理 ==========

def backup_run():
    from core.device_loader import load_devices
    from core.backup import BackupEngine
    devices = load_devices()
    engine = BackupEngine()
    _capture(engine.backup_all, devices)
    _capture(engine.generate_report_file)
    results = [r.to_dict() for r in engine.results]
    return json.dumps({"success": True, "data": results})


def backup_list():
    from core.backup import BackupEngine
    engine = BackupEngine()
    files = engine.list_backups()
    data = []
    for f in files:
        fp = os.path.join(engine.backup_dir, f)
        data.append({"filename": f, "size": os.path.getsize(fp), "path": fp})
    return json.dumps({"success": True, "data": data})


def backup_content(filename):
    from core.backup import BackupEngine
    engine = BackupEngine()
    filepath = os.path.join(engine.backup_dir, filename)
    if not os.path.exists(filepath):
        return json.dumps({"success": False, "error": f"文件不存在: {filename}"})
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    return json.dumps({"success": True, "data": content})


def backup_delete(filename):
    """删除备份文件"""
    from core.backup import BackupEngine
    engine = BackupEngine()
    filepath = os.path.join(engine.backup_dir, filename)
    if not os.path.exists(filepath):
        return json.dumps({"success": False, "error": f"文件不存在: {filename}"})
    os.remove(filepath)
    # 如果删除的是基线，从基线列表中移除
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
    return json.dumps({"success": True, "data": f"已删除: {filename}"})


def backup_run_device(host):
    """备份指定设备"""
    from core.device_loader import load_devices
    from core.backup import BackupEngine
    devices = load_devices()
    device = None
    for d in devices:
        if d.get("host") == host or d.get("name") == host:
            device = d
            break
    if not device:
        return json.dumps({"success": False, "error": f"设备 {host} 未找到"})
    engine = BackupEngine()
    result = _capture(engine.backup_device, device)
    return json.dumps({"success": True, "data": result.to_dict()})


def backup_set_baseline(filename):
    """设置某个备份为基线（支持多个）"""
    baselines_file = os.path.join(PROJECT_ROOT, "config", ".baselines.json")
    try:
        if os.path.exists(baselines_file):
            with open(baselines_file, "r") as f:
                bl = json.load(f)
        else:
            bl = {}
        bl_list = bl.get("baselines", [])
        if filename not in bl_list:
            bl_list.append(filename)
        bl["baselines"] = bl_list
        with open(baselines_file, "w") as f:
            json.dump(bl, f, indent=2)
        return json.dumps({"success": True, "data": f"基线已添加: {filename}"})
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


def backup_get_baseline():
    """获取所有基线"""
    baselines_file = os.path.join(PROJECT_ROOT, "config", ".baselines.json")
    if not os.path.exists(baselines_file):
        return json.dumps({"success": True, "data": []})
    with open(baselines_file, "r") as f:
        bl = json.load(f)
    return json.dumps({"success": True, "data": bl.get("baselines", [])})


def backup_clear_baseline(filename=""):
    """清除基线，不传文件名则清除全部"""
    baselines_file = os.path.join(PROJECT_ROOT, "config", ".baselines.json")
    if not os.path.exists(baselines_file):
        return json.dumps({"success": True, "data": "无可清除的基线"})
    with open(baselines_file, "r") as f:
        bl = json.load(f)
    bl_list = bl.get("baselines", [])
    if filename and filename in bl_list:
        bl_list.remove(filename)
    elif not filename:
        bl_list = []
    else:
        return json.dumps({"success": False, "error": f"基线 {filename} 不存在"})
    if bl_list:
        bl["baselines"] = bl_list
        with open(baselines_file, "w") as f:
            json.dump(bl, f, indent=2)
    else:
        os.remove(baselines_file)
    return json.dumps({"success": True, "data": "基线已清除"})


# ========== SSH 交互 ==========

def ssh_connect(host, username, password, device_type, command, port="", protocol=""):
    from core.ssh_client import SSHClient, SSHClientError
    device = {"host": host, "username": username, "password": password,
              "device_type": device_type or "huawei", "name": host}
    if port:
        device["port"] = int(port)
    if protocol:
        device["protocol"] = protocol
    client = SSHClient(device)
    client.connect()
    # ["修复"] 单命令也使用视图感知执行，包装成单元素列表
    # 避免直接 send_command 导致在用户视图下发配置命令
    output = client.send_commands_with_views([command])
    client.disconnect()
    return json.dumps({"success": True, "data": output})


def ssh_connect_batch(host, username, password, device_type, commands_json, port="", protocol=""):
    """通过单次连接批量执行多条命令，支持 SSH 和 Telnet"""
    from core.ssh_client import SSHClient, SSHClientError
    device = {"host": host, "username": username, "password": password,
              "device_type": device_type or "huawei", "name": host}
    if port:
        device["port"] = int(port)
    if protocol:
        device["protocol"] = protocol
    try:
        commands = json.loads(commands_json)
    except json.JSONDecodeError:
        return json.dumps({"success": False, "error": "无效的命令列表 JSON"})
    if not isinstance(commands, list):
        return json.dumps({"success": False, "error": "commands 必须是数组"})
    client = SSHClient(device)
    client.connect()
    output = client.send_commands_with_views(commands)
    client.disconnect()
    return json.dumps({"success": True, "data": output})


# ========== 连通性检测 ==========

def ping(target):
    from core.checker import ConnectivityChecker
    checker = ConnectivityChecker(verbose=False)
    result = checker.ping(target, count=2)
    return json.dumps({
        "success": True,
        "data": {"target": result.target, "reachable": result.success,
                 "rtt_ms": result.rtt_ms, "packet_loss": result.packet_loss}
    })


def port_check(target, port):
    from core.checker import ConnectivityChecker
    checker = ConnectivityChecker(verbose=False)
    result = checker.check_tcp_port(target, int(port), timeout=5)
    return json.dumps({
        "success": True,
        "data": {"target": result.target, "port": result.port,
                 "open": result.success, "rtt_ms": result.rtt_ms}
    })


# ========== 配置对比 ==========

def diff_compare(old_file, new_file):
    from core.differ import ConfigDiffer
    differ = ConfigDiffer()
    result = differ.compare_files(old_file, new_file)
    if result.error_message:
        return json.dumps({"success": False, "error": result.error_message})
    return json.dumps({
        "success": True,
        "data": {
            "old_name": result.old_name, "new_name": result.new_name,
            "added": result.added_lines, "removed": result.removed_lines,
            "changed_blocks": result.changed_lines,
            "has_changes": result.has_changes, "diff": result.diff_lines,
        }
    })


def diff_list():
    import glob
    from core.differ import ConfigDiffer
    differ = ConfigDiffer()
    report_dir = differ.backup_engine.backup_dir
    reports = sorted(glob.glob(os.path.join(report_dir, "diff_report_*.txt")), reverse=True)
    data = [{"filename": os.path.basename(rp), "size": os.path.getsize(rp), "path": rp} for rp in reports]
    return json.dumps({"success": True, "data": data})


# ========== 自动化巡检 ==========

def inspect_run():
    from core.device_loader import load_devices
    from core.inspector import Inspector
    inspector = Inspector(template_file=TEMPLATE_FILE)
    devices = load_devices()
    _capture(inspector.inspect_all, devices)
    results = [r.to_dict() for r in inspector.results]
    return json.dumps({"success": True, "data": results})


def inspect_list():
    import glob
    from core.inspector import Inspector
    insp = Inspector()
    reports = sorted(glob.glob(os.path.join(insp.output_dir, "inspect_report_*.txt")), reverse=True)
    data = [{"filename": os.path.basename(rp), "size": os.path.getsize(rp), "path": rp} for rp in reports]
    return json.dumps({"success": True, "data": data})


def inspect_delete(filename):
    """删除巡检报告"""
    from core.inspector import Inspector
    insp = Inspector()
    filepath = os.path.join(insp.output_dir, filename)
    if not os.path.exists(filepath):
        return json.dumps({"success": False, "error": f"文件不存在: {filename}"})
    os.remove(filepath)
    return json.dumps({"success": True, "data": f"已删除: {filename}"})


def inspect_run_device(host):
    """巡检指定设备"""
    from core.device_loader import load_devices
    from core.inspector import Inspector
    devices = load_devices()
    device = None
    for d in devices:
        if d.get("host") == host or d.get("name") == host:
            device = d
            break
    if not device:
        return json.dumps({"success": False, "error": f"设备 {host} 未找到"})
    inspector = Inspector(template_file=TEMPLATE_FILE)
    _capture(inspector.inspect_all, [device])
    results = [r.to_dict() for r in inspector.results]
    return json.dumps({"success": True, "data": results})


# ========== 巡检模板管理（逗号分隔格式）==========

TEMPLATE_FILE = os.path.join(PROJECT_ROOT, "config", "inspect_templates.json")


def inspect_template_get():
    """获取当前逗号分隔的巡检命令"""
    import core.inspector
    core.inspector.TEMPLATE_FILE = TEMPLATE_FILE
    if os.path.exists(TEMPLATE_FILE):
        try:
            with open(TEMPLATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            cmds = data.get("commands", "")
            return json.dumps({"success": True, "data": cmds})
        except Exception:
            pass
    return json.dumps({"success": True, "data": ""})


def inspect_template_set():
    """设置巡检模板：逗号分隔的命令字符串"""
    cmds = _get_arg(2)  # 如 "display version, display interface brief"
    if not cmds:
        return json.dumps({"success": False, "error": "缺少命令"})
    try:
        os.makedirs(os.path.dirname(TEMPLATE_FILE), exist_ok=True)
        with open(TEMPLATE_FILE, "w", encoding="utf-8") as f:
            json.dump({"commands": cmds}, f, indent=2, ensure_ascii=False)
        import core.inspector
        core.inspector.TEMPLATE_FILE = TEMPLATE_FILE
        return json.dumps({"success": True, "data": "模板已保存"})
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


def inspect_template_delete():
    """删除自定义模板"""
    if os.path.exists(TEMPLATE_FILE):
        os.remove(TEMPLATE_FILE)
    import core.inspector
    core.inspector.TEMPLATE_FILE = TEMPLATE_FILE
    return json.dumps({"success": True, "data": "模板已清除"})


# ========== 文件读取 ==========

def read_file(filepath):
    if not os.path.exists(filepath):
        return json.dumps({"success": False, "error": f"文件不存在: {filepath}"})
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    return json.dumps({"success": True, "data": content})


# ========== eNSP 拓扑分析 ==========

TOPO_CACHE_FILE = os.path.join(API_DIR, "..", "topos", ".topo_cache.json")


def _save_topo_cache(data: dict, filepath: str):
    """将拓扑数据保存到文件缓存"""
    cache = {"filepath": filepath, "topology": data}
    os.makedirs(os.path.dirname(TOPO_CACHE_FILE), exist_ok=True)
    with open(TOPO_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)


def _load_topo_cache():
    """从文件缓存读取拓扑数据"""
    if not os.path.exists(TOPO_CACHE_FILE):
        return None, None
    try:
        with open(TOPO_CACHE_FILE, "r", encoding="utf-8") as f:
            cache = json.load(f)
        return cache.get("topology"), cache.get("filepath", "")
    except (json.JSONDecodeError, IOError):
        return None, None


def ensp_load_topology(filepath):
    """加载并解析 .topo 拓扑文件"""
    from ensp_parser import load_topo
    result = load_topo(filepath)
    if result.get("success"):
        _save_topo_cache(result["data"], filepath)
    return json.dumps(result)


def ensp_list_devices():
    """列出已加载拓扑中的设备列表"""
    topology, filepath = _load_topo_cache()
    if not topology:
        return json.dumps({"success": False, "error": "未加载拓扑，请先调用 ensp_load_topology"})
    devices = topology.get("devices", [])
    return json.dumps({
        "success": True,
        "data": [{
            "name": d["name"],
            "model": d["model"],
            "device_type": d["device_type"],
            "is_configurable": d["is_configurable"],
            "com_port": d["com_port"],
            "interfaces": d["interfaces"],
        } for d in devices]
    })


def ensp_get_topology_info():
    """获取完整拓扑详情"""
    topology, filepath = _load_topo_cache()
    if not topology:
        return json.dumps({"success": False, "error": "未加载拓扑，请先调用 ensp_load_topology"})
    return json.dumps({"success": True, "data": topology})


def ensp_clear_topology():
    """清除拓扑缓存"""
    if os.path.exists(TOPO_CACHE_FILE):
        try:
            os.remove(TOPO_CACHE_FILE)
        except OSError:
            pass
    return json.dumps({"success": True, "data": "拓扑缓存已清除"})


# ========== 命令路由 ==========

COMMANDS = {
    "devices": device_list,
    "device_credentials": lambda: (device_get_credentials(*_get_json_args()) if len(_get_json_args()) >= 1
                                     else json.dumps({"success": False, "error": "缺少必要的参数: host（需要 Base64 编码的 JSON 数组 [host, port]）"})),
    "ensp_load_topology": lambda: ensp_load_topology(_get_arg(2)),
    "ensp_list_devices": ensp_list_devices,
    "ensp_get_topology_info": ensp_get_topology_info,
    "ensp_clear_topology": ensp_clear_topology,
    "device_add": lambda: device_add(*_get_json_args()),
    "device_update": lambda: device_update(*_get_json_args()),
    "device_delete": lambda: (device_delete(*_get_json_args()) if len(_get_json_args()) >= 1
                                else json.dumps({"success": False, "error": "缺少必要的参数: host, port"})),
    "backup_run": backup_run,
    "backup_run_device": lambda: backup_run_device(_get_arg(2)),
    "backup_list": backup_list,
    "backup_content": lambda: backup_content(_get_arg(2)),
    "backup_delete": lambda: backup_delete(_get_arg(2)),
    "backup_set_baseline": lambda: backup_set_baseline(_get_arg(2)),
    "backup_get_baseline": backup_get_baseline,
    "backup_clear_baseline": lambda: backup_clear_baseline(_get_arg(2)),
    "ssh_connect": lambda: ssh_connect(*_get_args(7)),
    "ssh_connect_batch": lambda: ssh_connect_batch(*_get_args(7)),
    "ping": lambda: ping(_get_arg(2)),
    "port": lambda: port_check(_get_arg(2), _get_arg(3)),
    "diff_compare": lambda: diff_compare(_get_arg(2), _get_arg(3)),
    "diff_list": diff_list,
    "inspect_run": inspect_run,
    "inspect_run_device": lambda: inspect_run_device(_get_arg(2)),
    "inspect_list": inspect_list,
    "inspect_delete": lambda: inspect_delete(_get_arg(2)),
    "inspect_template_get": inspect_template_get,
    "inspect_template_set": inspect_template_set,
    "inspect_template_delete": inspect_template_delete,
    "read_file": lambda: read_file(_get_arg(2)),
}


def _get_arg(index):
    return sys.argv[index] if len(sys.argv) > index else ""


def _get_args(count):
    return [sys.argv[i] if len(sys.argv) > i else "" for i in range(2, 2 + count)]


def _get_json_args():
    """从单个 Base64 编码的 JSON 参数中解析参数列表（解决 shell 丢弃空字符串和引号的问题）"""
    if len(sys.argv) < 3:
        return []
    try:
        import base64
        decoded = base64.b64decode(sys.argv[2]).decode('utf-8')
        return json.loads(decoded)
    except Exception:
        return []


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "缺少命令参数"}))
        return
    command = sys.argv[1]
    handler = COMMANDS.get(command)
    if handler is None:
        print(json.dumps({"success": False, "error": f"未知命令: {command}"}))
        return
    try:
        result = handler()
        start = result.find("{")
        end = result.rfind("}")
        if start >= 0 and end > start:
            result = result[start:end + 1]
        print(result, flush=True)
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
