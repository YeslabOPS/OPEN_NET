"""
APScheduler 调度器
支持:
  - 任务类型: 全量备份, 全量巡检, 指定设备备份, 指定设备巡检
  - 触发类型: date (指定时间点), duration (延迟执行)
一次执行后自动删除（非循环任务）
"""
import os
import json
import uuid
import re
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Callable

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.date import DateTrigger

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEDULES_FILE = os.path.join(PROJECT_ROOT, "config", "schedules.json")


def _load_schedules() -> list:
    if not os.path.exists(SCHEDULES_FILE):
        return []
    try:
        with open(SCHEDULES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("schedules", [])
    except (json.JSONDecodeError, IOError):
        return []


def _save_schedules(schedules: list):
    os.makedirs(os.path.dirname(SCHEDULES_FILE), exist_ok=True)
    with open(SCHEDULES_FILE, "w", encoding="utf-8") as f:
        json.dump({"schedules": schedules}, f, indent=2, ensure_ascii=False)


def _gen_id() -> str:
    return datetime.now().strftime("sched_%Y%m%d_%H%M%S_") + uuid.uuid4().hex[:6]


# ========== 任务执行函数 ==========


def _execute_backup_all():
    from core.device_loader import load_devices
    from core.backup import BackupEngine
    devices = load_devices()
    engine = BackupEngine()
    engine.backup_all(devices)
    engine.generate_report_file()
    print(f"[Scheduler] 全量备份完成: {len(engine.results)} 台设备")


def _execute_inspect_all():
    from core.device_loader import load_devices
    from core.inspector import Inspector
    devices = load_devices()
    TEMPLATE_FILE = os.path.join(PROJECT_ROOT, "config", "inspect_templates.json")
    inspector = Inspector(template_file=TEMPLATE_FILE)
    inspector.inspect_all(devices)
    print(f"[Scheduler] 全量巡检完成: {len(inspector.results)} 台设备")


def _execute_backup_device(device_name: str):
    from core.device_loader import load_devices
    from core.backup import BackupEngine
    devices = load_devices()
    device = next((d for d in devices if d.get("name") == device_name or d.get("host") == device_name), None)
    if not device:
        print(f"[Scheduler] 设备 {device_name} 未找到")
        return
    engine = BackupEngine()
    result = engine.backup_device(device)
    print(f"[Scheduler] 设备 {device_name} 备份: {'成功' if result.success else '失败'}")


def _execute_inspect_device(device_name: str):
    from core.device_loader import load_devices
    from core.inspector import Inspector
    devices = load_devices()
    device = next((d for d in devices if d.get("name") == device_name or d.get("host") == device_name), None)
    if not device:
        print(f"[Scheduler] 设备 {device_name} 未找到")
        return
    TEMPLATE_FILE = os.path.join(PROJECT_ROOT, "config", "inspect_templates.json")
    inspector = Inspector(template_file=TEMPLATE_FILE)
    inspector.inspect_all([device])
    print(f"[Scheduler] 设备 {device_name} 巡检完成")


TASK_EXECUTORS: Dict[str, Callable] = {
    "backup_all": lambda: _execute_backup_all(),
    "inspect_all": lambda: _execute_inspect_all(),
}


def parse_duration_text(text: str) -> int:
    """解析人类可读时长文本为秒数
    
    支持格式:
      1小时5分钟10秒
      1小时
      30分钟
      45秒
      1h5m10s
      3600 (纯数字 = 秒)
    """
    text = text.strip()
    
    # 纯数字 = 秒
    if text.isdigit():
        return int(text)
    
    hours = minutes = seconds = 0.0
    
    # 匹配中文格式: X小时 Y分钟 Z秒
    zh_match = re.match(
        r'(?:(\d+(?:\.\d+)?)小时)?\s*'
        r'(?:(\d+(?:\.\d+)?)分钟)?\s*'
        r'(?:(\d+(?:\.\d+)?)秒)?',
        text
    )
    if zh_match and any(g is not None for g in zh_match.groups()):
        hours = float(zh_match.group(1) or 0)
        minutes = float(zh_match.group(2) or 0)
        seconds = float(zh_match.group(3) or 0)
        return int(hours * 3600 + minutes * 60 + seconds)
    
    # 匹配英文格式: Xh Ym Zs
    en_match = re.match(
        r'(?:(\d+(?:\.\d+)?)h)?\s*'
        r'(?:(\d+(?:\.\d+)?)m)?\s*'
        r'(?:(\d+(?:\.\d+)?)s)?',
        text, re.IGNORECASE
    )
    if en_match and any(g is not None for g in en_match.groups()):
        hours = float(en_match.group(1) or 0)
        minutes = float(en_match.group(2) or 0)
        seconds = float(en_match.group(3) or 0)
        return int(hours * 3600 + minutes * 60 + seconds)
    
    raise ValueError(f"无法解析时长: {text}，支持格式: 1小时5分钟10秒 或 1h5m10s 或 3600")


def format_duration(seconds: int) -> str:
    """将秒数格式化为人类可读时长"""
    if seconds <= 0:
        return "0秒"
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    parts = []
    if h > 0:
        parts.append(f"{h}小时")
    if m > 0:
        parts.append(f"{m}分钟")
    if s > 0:
        parts.append(f"{s}秒")
    return "".join(parts) if parts else f"{seconds}秒"


class SchedulerManager:
    def __init__(self):
        self.scheduler = BackgroundScheduler()
        self.schedules: List[dict] = []
        self.job_map: Dict[str, str] = {}
        self._load_and_register()

    def _load_and_register(self):
        self.schedules = _load_schedules()
        for sched in self.schedules:
            if sched.get("enabled", True):
                self._register_job(sched)

    def start(self):
        if not self.scheduler.running:
            self.scheduler.start()

    def stop(self):
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)

    def _get_run_datetime(self, sched: dict) -> Optional[datetime]:
        """计算任务的执行时间"""
        trigger_type = sched.get("trigger_type", "date")
        
        if trigger_type == "date":
            run_at = sched.get("run_at")
            if run_at:
                return datetime.fromisoformat(run_at)
            return None
        
        elif trigger_type == "duration":
            delay = sched.get("delay_seconds", 0)
            if delay > 0:
                return datetime.now() + timedelta(seconds=delay)
            return None
        
        return None

    def _get_job_func(self, sched: dict) -> Callable:
        task_type = sched.get("type", "backup_all")
        device_name = sched.get("device_name", "")
        
        if task_type == "backup_all":
            return _execute_backup_all
        elif task_type == "inspect_all":
            return _execute_inspect_all
        elif task_type == "backup_device":
            return lambda: _execute_backup_device(device_name)
        elif task_type == "inspect_device":
            return lambda: _execute_inspect_device(device_name)
        return _execute_backup_all

    def _register_job(self, sched: dict):
        sched_id = sched.get("id", "")
        if not sched_id:
            return
        
        if sched_id in self.job_map:
            try:
                self.scheduler.remove_job(self.job_map[sched_id])
            except Exception:
                pass
        
        run_time = self._get_run_datetime(sched)
        if not run_time:
            return
        
        trigger = DateTrigger(run_date=run_time)
        func = self._get_job_func(sched)
        
        # 包装函数: 执行完成后自动删除该调度任务
        def wrapped_func():
            try:
                func()
                # 更新 last_run
                for item in self.schedules:
                    if item.get("id") == sched_id:
                        item["last_run"] = datetime.now().isoformat()
                        break
            except Exception as e:
                print(f"[Scheduler] 任务 {sched_id} 执行失败: {e}")
            finally:
                # 执行后自动移除
                self.remove_schedule(sched_id)
                print(f"[Scheduler] 任务 {sched_id} 执行完毕，自动移除")
        
        job = self.scheduler.add_job(
            wrapped_func,
            trigger,
            id=sched_id,
            name=sched.get("name", sched_id),
            replace_existing=True,
        )
        self.job_map[sched_id] = job.id

    def _unregister_job(self, sched_id: str):
        if sched_id in self.job_map:
            try:
                self.scheduler.remove_job(self.job_map[sched_id])
            except Exception:
                pass
            del self.job_map[sched_id]

    def _persist(self):
        _save_schedules(self.schedules)

    def get_all_schedules(self) -> List[dict]:
        result = []
        for sched in self.schedules:
            entry = dict(sched)
            sched_id = entry.get("id", "")
            if sched_id in self.job_map:
                try:
                    job = self.scheduler.get_job(self.job_map[sched_id])
                    if job:
                        entry["next_run_time"] = job.next_run_time.isoformat() if job.next_run_time else None
                except Exception:
                    pass
            if "last_run" not in entry:
                entry["last_run"] = None
            result.append(entry)
        return result

    def add_schedule(self, name: str, schedule_type: str,
                     trigger_type: str = "date",
                     run_at: Optional[str] = None,
                     delay_seconds: int = 0,
                     device_name: Optional[str] = None,
                     enabled: bool = True) -> dict:
        sched_id = _gen_id()
        sched = {
            "id": sched_id,
            "name": name,
            "type": schedule_type,
            "trigger_type": trigger_type,
            "run_at": run_at if trigger_type == "date" else None,
            "delay_seconds": delay_seconds if trigger_type == "duration" else 0,
            "device_name": device_name or "",
            "enabled": enabled,
            "created_at": datetime.now().isoformat(),
            "last_run": None,
        }
        self.schedules.append(sched)
        if enabled:
            self._register_job(sched)
        self._persist()
        return sched

    def update_schedule(self, sched_id: str, updates: dict) -> dict:
        for sched in self.schedules:
            if sched.get("id") == sched_id:
                allowed_keys = {"name", "type", "trigger_type", "run_at",
                                "delay_seconds", "device_name", "enabled"}
                for key, value in updates.items():
                    if value is not None and key in allowed_keys:
                        sched[key] = value
                self._unregister_job(sched_id)
                if sched.get("enabled", True):
                    self._register_job(sched)
                self._persist()
                return sched
        raise ValueError(f"调度任务 {sched_id} 不存在")

    def remove_schedule(self, sched_id: str):
        self.schedules = [s for s in self.schedules if s.get("id") != sched_id]
        self._unregister_job(sched_id)
        self._persist()

    def trigger_schedule(self, sched_id: str):
        for sched in self.schedules:
            if sched.get("id") == sched_id:
                func = self._get_job_func(sched)
                func()
                sched["last_run"] = datetime.now().isoformat()
                self.remove_schedule(sched_id)  # 触发即移除
                return
        raise ValueError(f"调度任务 {sched_id} 不存在")


if __name__ == "__main__":
    import time
    mgr = SchedulerManager()
    mgr.start()
    print("调度器已启动，按 Ctrl+C 退出...")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        mgr.stop()
        print("调度器已停止")
