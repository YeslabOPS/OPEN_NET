"""
eNSP MCP Server
使用轻量级 FastMCP 框架，官方 SDK 风格的装饰器方式
"""
import logging
import os
from pathlib import Path
from typing import Optional

from .mcp_framework import FastMCP
from .models import ConnectionMethod
from .device_manager import DeviceManager, get_device_manager, set_device_manager
from .connection import get_connection_manager

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 初始化 MCP Server（使用装饰器风格）
mcp = FastMCP("ensp", version="0.2.0")

# 初始化设备管理器和连接管理器
device_manager = DeviceManager()
connection_manager = get_connection_manager()
set_device_manager(device_manager)


# ============================================================================
# 工具定义（SDK 装饰器风格）
# ============================================================================

@mcp.tool()
async def init_project(working_dir: str = "", auto_load: bool = True) -> str:
    """初始化 eNSP 项目，扫描工作目录，发现拓扑文件和配置文件"""
    work_path = Path(working_dir).resolve() if working_dir else Path.cwd().resolve()

    device_manager.working_dir = work_path
    device_manager.cache_dir = work_path / "data"

    result = {
        "working_dir": str(work_path),
        "discovered_files": {"topo_files": [], "cfg_files": [], "flash_dirs": []},
        "missing_files": [], "recommendations": [], "topology_loaded": False
    }

    topo_files = list(work_path.rglob("*.topo"))
    result["discovered_files"]["topo_files"] = [str(f.relative_to(work_path)) for f in topo_files]

    cfg_files = list(work_path.rglob("*.cfg"))
    result["discovered_files"]["cfg_files"] = [str(f.relative_to(work_path)) for f in cfg_files]

    flash_dirs = set()
    for pattern in ["**/flash.efz", "**/vrpcfg.zip"]:
        for f in work_path.rglob(pattern):
            flash_dirs.add(str(f.parent.relative_to(work_path)))
    result["discovered_files"]["flash_dirs"] = list(flash_dirs)

    if not topo_files:
        result["missing_files"].append("未找到 .topo 拓扑文件")
        result["recommendations"].append("请上传 eNSP 拓扑文件 (.topo)")
    else:
        result["recommendations"].append(
            f"发现拓扑文件 {topo_files[0].relative_to(work_path)}"
        )
        if auto_load:
            try:
                device_manager.load_topology(str(topo_files[0]))
                result["topology_loaded"] = True
                result["recommendations"].append(
                    f"已自动加载拓扑，共 {len(device_manager.get_all_devices())} 个设备"
                )
            except Exception as e:
                result["recommendations"].append(f"自动加载失败: {e}")

    return _fmt_init(result)


@mcp.tool()
async def load_topology(topo_file: str) -> str:
    """加载 eNSP 拓扑文件 (.topo)，解析设备信息和连接关系"""
    topology = device_manager.load_topology(topo_file)
    o = f"# 拓扑加载成功\n\n**源文件**: {topology.source_file}\n"
    o += f"**版本**: {topology.version}\n**设备数量**: {len(topology.devices)}\n"
    o += f"**可配置设备**: {len(topology.get_configurable_devices())}\n"
    o += f"**连接数量**: {len(topology.connections)}\n\n## 设备列表\n\n"
    for d in device_manager.get_device_list_summary():
        o += f"- **{d['name']}** ({d['model']}) - 端口: {d['com_port']}\n"
    return o


@mcp.tool()
async def list_devices(model: str = "", configurable_only: bool = False) -> str:
    """列出已加载拓扑中的所有设备"""
    if not device_manager.is_loaded():
        device_manager.load_from_cache()
    if not device_manager.is_loaded():
        return "未加载拓扑，请先使用 load-topology"

    devices = device_manager.get_configurable_devices() if configurable_only else device_manager.get_all_devices()
    if model:
        devices = [d for d in devices if d.model == model]
    if not devices:
        return "没有匹配的设备"

    o = f"# 设备列表 (共 {len(devices)} 个)\n\n| 名称 | 型号 | 端口 | 类型 | 可配置 |\n|------|------|------|------|--------|\n"
    for d in devices:
        o += f"| {d.name} | {d.model} | {d.com_port} | {d.device_type.value} | {'✓' if d.is_configurable else '✗'} |\n"
    return o


@mcp.tool()
async def get_topology_info() -> str:
    """获取当前加载的拓扑信息摘要"""
    info = device_manager.get_topology_info()
    if not info["loaded"]:
        return info["message"]
    return (f"# 拓扑信息\n\n**源文件**: {info['source_file']}\n"
            f"**版本**: {info['version']}\n"
            f"**设备数量**: {info['device_count']}\n"
            f"**可配置设备**: {info['configurable_count']}\n"
            f"**连接数量**: {info['connection_count']}\n")


@mcp.tool()
async def test_connectivity(devices: list = None, method: str = "telnet", timeout: int = 5) -> str:
    """测试设备连通性，支持批量测试所有设备"""
    if not device_manager.is_loaded():
        device_manager.load_from_cache()
    if not device_manager.is_loaded():
        return "未加载拓扑"

    conn_method = ConnectionMethod.TELNET if method == "telnet" else ConnectionMethod.SSH
    dev_list = [d for name in (devices or []) if (d := device_manager.get_device(name))]
    if not dev_list:
        dev_list = device_manager.get_configurable_devices()
    if not dev_list:
        return "没有要测试的设备"

    results = await connection_manager.batch_test(dev_list, conn_method, timeout)
    ok = sum(1 for r in results if r["connectivity"] == "ok")

    o = f"# 连通性测试结果\n\n**方式**: {method}  **成功**: {ok}/{len(results)}\n\n| 设备 | 型号 | 端口 | 状态 | 响应 |\n|------|------|------|------|------|\n"
    for r in results:
        s = "✓" if r["connectivity"] == "ok" else f"✗ {r.get('error', '')}"
        o += f"| {r['device']} | {r['model']} | {r['com_port']} | {s} | {r['response_time_ms']}ms |\n"
    return o


@mcp.tool()
async def configure_device_by_name(
    device_name: str,
    commands: list,
    username: str = "",
    password: str = "",
    connection_method: str = "telnet",
    save_config: bool = False
) -> str:
    """通过设备名称配置设备，自动查找连接端口，系统自动处理 system-view 和 return，无需在 commands 中包含。如需保存配置请在 commands 末尾加 return/save/y 或设置 save_config=True。支持 Telnet 和 SSH"""
    device = device_manager.get_device(device_name)
    if not device:
        return f"设备 '{device_name}' 未找到"
    if not device.is_configurable:
        return f"设备 '{device_name}' 不可配置"

    method = ConnectionMethod.TELNET if connection_method == "telnet" else ConnectionMethod.SSH
    result = await connection_manager.configure_device(
        device, commands, method, username, password, save_config
    )

    o = f"# 配置结果\n\n**设备**: {result['device']}\n**端口**: {result['com_port']}\n"
    o += f"**状态**: {'✓ 成功' if result['success'] else '✗ 失败'}\n"
    o += f"**命令数**: {result['commands_executed']}  **已保存**: {'✓' if result['saved'] else '✗'}\n\n"
    if result.get("error"):
        o += f"**错误**: {result['error']}\n\n"
    if result.get("output"):
        o += f"## 输出\n```\n{result['output']}\n```\n"
    return o


@mcp.tool()
async def show_device_by_name(
    device_name: str,
    command: str,
    username: str = "",
    password: str = "",
    connection_method: str = "telnet"
) -> str:
    """通过设备名称执行查询命令"""
    device = device_manager.get_device(device_name)
    if not device:
        return f"设备 '{device_name}' 未找到"

    method = ConnectionMethod.TELNET if connection_method == "telnet" else ConnectionMethod.SSH
    result = await connection_manager.execute_commands(device, [command], method, username, password)

    o = f"# 设备信息查询\n\n**设备**: {result['device']}\n**命令**: {command}\n"
    o += f"**状态**: {'✓ 成功' if result['success'] else '✗ 失败'}\n\n"
    if result.get("error"):
        o += f"**错误**: {result['error']}\n\n"
    if result.get("output"):
        o += f"## 输出\n```\n{result['output']}\n```\n"
    return o


@mcp.tool()
async def batch_configure(
    devices: list,
    username: str = "",
    password: str = "",
    connection_method: str = "telnet",
    save_config: bool = False
) -> str:
    """批量配置多个设备，系统自动处理 system-view 和 return，无需在 commands 中包含。如需保存请在 commands 末尾加 return/save/y 或设置 save_config=True"""
    method = ConnectionMethod.TELNET if connection_method == "telnet" else ConnectionMethod.SSH
    results = []

    for dc in devices:
        d = device_manager.get_device(dc.get("name", ""))
        if not d:
            results.append({"device": dc["name"], "success": False, "error": "设备未找到"})
            continue
        r = await connection_manager.configure_device(d, dc.get("commands", []), method, username, password, save_config)
        results.append(r)

    ok = sum(1 for r in results if r.get("success"))
    o = f"# 批量配置结果\n\n**成功**: {ok}/{len(results)}\n\n| 设备 | 端口 | 状态 | 命令数 | 保存 |\n|------|------|------|--------|------|\n"
    for r in results:
        s = "✓" if r.get("success") else f"✗ {r.get('error', '')}"
        sv = "✓" if r.get("saved") else "✗"
        o += f"| {r['device']} | {r.get('com_port', '-')} | {s} | {r.get('commands_executed', 0)} | {sv} |\n"
    return o


@mcp.tool()
async def save_to_file(content: str, file_path: str) -> str:
    """将内容保存到指定文件"""
    path = Path(file_path)
    if not path.is_absolute():
        path = Path.cwd() / path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')
    return f"文件已保存到: {path}"


@mcp.tool()
async def run_inspection(device_name: str = "", all: bool = False) -> str:
    """对设备执行自动化巡检，收集版本、接口、CPU、内存等信息，生成巡检报告"""
    try:
        from core.inspector import Inspector
        from core.device_loader import load_devices

        inspector = Inspector()
        devices = load_devices()

        if device_name:
            # 按名称查找设备
            device = next((d for d in devices if d.get('name') == device_name), None)
            if not device:
                # 也尝试按 IP 查找
                device = next((d for d in devices if d.get('host') == device_name), None)
            if not device:
                return f"设备 '{device_name}' 未找到 (请确认 config/devices.yaml 中的配置)"
            result = inspector.inspect_device(device)
            inspector.results = [result]
        else:
            inspector.inspect_all(devices)

        report_path = inspector.generate_report()
        ok = sum(1 for r in inspector.results if r.connected)
        return f"## 巡检完成\n\n报告文件: {report_path}\n\n共 {len(inspector.results)} 台设备，连接成功 {ok}/{len(inspector.results)} 台\n\n详细结果请查看报告文件。"
    except Exception as e:
        logger.error(f"巡检失败: {e}")
        return f"巡检执行失败: {e}"


@mcp.tool()
async def backup_config(device_name: str = "", all: bool = False) -> str:
    """备份设备配置，指定 device_name 备份单台，all=True 备份全部"""
    try:
        from core.backup import BackupEngine
        from core.device_loader import load_devices

        backup = BackupEngine()
        devices = load_devices()

        if device_name:
            device = next((d for d in devices if d.get('name') == device_name), None)
            if not device:
                device = next((d for d in devices if d.get('host') == device_name), None)
            if not device:
                return f"设备 '{device_name}' 未找到"
            result = backup.backup_device(device)
            backup.results = [result]
        else:
            backup.backup_all(devices)

        report_path = backup.generate_report_file()
        o = f"# 配置备份结果\n\n报告文件: {report_path}\n\n"
        for r in backup.results:
            status = "✓" if r.success else "✗"
            o += f"- **{r.device_name}** ({r.host}): {status}"
            if r.success:
                o += f" → {r.filename}\n"
            else:
                o += f" → {r.error_message}\n"
        return o
    except Exception as e:
        logger.error(f"备份失败: {e}")
        return f"备份执行失败: {e}"


@mcp.tool()
async def diff_compare_configs(old_file: str, new_file: str) -> str:
    """对比两个配置文件的差异"""
    try:
        from core.differ import ConfigDiffer

        differ = ConfigDiffer()
        # 支持直接传文件名（在 backups/ 目录下）或绝对路径
        if not os.path.isabs(old_file):
            old_file = os.path.join(differ.backup_engine.backup_dir, old_file)
        if not os.path.isabs(new_file):
            new_file = os.path.join(differ.backup_engine.backup_dir, new_file)

        if not os.path.exists(old_file):
            # 尝试用文件名搜索
            for f in os.listdir(differ.backup_engine.backup_dir):
                if old_file in f and f.endswith('.cfg'):
                    old_file = os.path.join(differ.backup_engine.backup_dir, f)
                    break
        if not os.path.exists(new_file):
            for f in os.listdir(differ.backup_engine.backup_dir):
                if new_file in f and f.endswith('.cfg'):
                    new_file = os.path.join(differ.backup_engine.backup_dir, f)
                    break

        result = differ.compare_files(old_file, new_file)

        o = f"# 配置对比结果\n\n**对比**: {result.old_name} ↔ {result.new_name}\n\n"
        if not result.has_changes:
            o += "**结论**: 两份配置文件完全一致，无变更。\n"
        else:
            o += f"**新增**: +{result.added_lines} 行\n"
            o += f"**删除**: -{result.removed_lines} 行\n"
            o += f"**变更块**: {result.changed_lines} 处\n\n"
            o += "## 差异明细\n\n```diff\n"
            for line in result.diff_lines[:200]:
                o += line + "\n"
            if len(result.diff_lines) > 200:
                o += f"... (剩余 {len(result.diff_lines) - 200} 行省略)\n"
            o += "```\n"

        if result.error_message:
            o += f"\n**错误**: {result.error_message}\n"
        return o
    except Exception as e:
        logger.error(f"对比失败: {e}")
        return f"对比执行失败: {e}"


@mcp.tool()
async def reset(hard: bool = False) -> str:
    """重置 MCP Server 状态，清除设备缓存和拓扑数据。新会话开始时建议先调用此工具。
    
    Args:
        hard: 如果为 True，同时删除缓存文件 (data/topology.json)
    """
    device_manager.topology = None
    if hard:
        device_manager.clear_cache()
        msg = f"已清除拓扑缓存和缓存文件"
    else:
        msg = f"已清除拓扑缓存（内存）"
    device_manager._yaml_port_overrides = {}
    logger.info(f"MCP 状态已重置 (hard={hard})")
    return f"# MCP 状态已重置\n\n{msg}\n\n请使用 `init-project` 或 `load-topology` 重新加载拓扑。"


# ============================================================================
# 格式化辅助
# ============================================================================

def _fmt_init(result: dict) -> str:
    lines = ["# eNSP 项目初始化报告\n"]
    lines.append(f"**工作目录**: {result['working_dir']}\n")

    d = result["discovered_files"]
    lines.append("## 发现的文件\n")
    if d["topo_files"]:
        lines.append("**拓扑文件**:\n" + "\n".join(f"  - {f}" for f in d["topo_files"]) + "\n")
    if d["cfg_files"]:
        lines.append(f"**配置文件**: {len(d['cfg_files'])} 个\n")
    if d["flash_dirs"]:
        lines.append(f"**Flash 目录**: {len(d['flash_dirs'])} 个\n")

    if result["missing_files"]:
        lines.append("## 缺失\n" + "\n".join(f"- {f}" for f in result["missing_files"]) + "\n")
    if result["recommendations"]:
        lines.append("## 建议\n" + "\n".join(f"- {r}" for r in result["recommendations"]) + "\n")
    if result["topology_loaded"]:
        lines.append("✓ 拓扑已加载")

    return "\n".join(lines)


# ============================================================================
# 入口
# ============================================================================

def run():
    """运行 MCP Server"""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    run()
