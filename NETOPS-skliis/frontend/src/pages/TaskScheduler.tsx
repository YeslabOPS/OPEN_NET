import React, { useState, useEffect, useCallback } from 'react';

interface Device {
  name: string;
  host: string;
  port: number;
  device_type: string;
}

interface ScheduleItem {
  id: string;
  name: string;
  type: string;
  trigger_type: string;
  run_at: string | null;
  delay_seconds: number;
  device_name: string;
  enabled: boolean;
  created_at: string;
  last_run: string | null;
  next_run_time: string | null;
}

const TASK_TYPES: Record<string, string> = {
  backup_all: '全量备份',
  inspect_all: '全量巡检',
  backup_device: '指定设备备份',
  inspect_device: '指定设备巡检',
};

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}小时`);
  if (m > 0) parts.push(`${m}分钟`);
  if (s > 0) parts.push(`${s}秒`);
  return parts.join('') || `${seconds}秒`;
}

function parseDurationFromInput(h: string, m: string, s: string): number {
  return (parseInt(h) || 0) * 3600 + (parseInt(m) || 0) * 60 + (parseInt(s) || 0);
}

const TaskScheduler: React.FC = () => {
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    type: 'backup_all',
    trigger_type: 'date' as 'date' | 'duration',
    run_at: '',
    delay_hours: '',
    delay_minutes: '',
    delay_seconds: '',
    device_name: '',
    enabled: true,
  });
  const [error, setError] = useState('');

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/schedule/list');
      const data = await res.json();
      if (data.success) setSchedules(data.data || []);
    } catch { } finally { setLoading(false); }
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch('/api/devices');
      const data = await res.json();
      if (data.success) setDevices(data.data || []);
    } catch { }
  }, []);

  useEffect(() => { fetchSchedules(); fetchDevices(); }, [fetchSchedules, fetchDevices]);

  const openAdd = () => {
    setEditingId(null);
    setError('');
    setShowModal(true);
    // Compute a default datetime 30 minutes from now
    const d = new Date(Date.now() + 30 * 60000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const defaultRunAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    setForm({
      name: '', type: 'backup_all', trigger_type: 'date',
      run_at: defaultRunAt,
      delay_hours: '', delay_minutes: '', delay_seconds: '',
      device_name: '', enabled: true,
    });
  };

  const openEdit = (sched: ScheduleItem) => {
    setEditingId(sched.id);
    setError('');
    const seconds = sched.delay_seconds || 0;
    setForm({
      name: sched.name,
      type: sched.type,
      trigger_type: sched.trigger_type as 'date' | 'duration',
      run_at: sched.run_at || '',
      delay_hours: String(Math.floor(seconds / 3600) || ''),
      delay_minutes: String(Math.floor((seconds % 3600) / 60) || ''),
      delay_seconds: String(seconds % 60 || ''),
      device_name: sched.device_name || '',
      enabled: sched.enabled,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('请输入任务名称'); return; }
    if (form.trigger_type === 'date' && !form.run_at) { setError('请选择执行时间'); return; }
    if (form.trigger_type === 'duration') {
      const total = parseDurationFromInput(form.delay_hours, form.delay_minutes, form.delay_seconds);
      if (total <= 0) { setError('请设置有效的时间间隔'); return; }
    }
    const isDeviceTask = form.type === 'backup_device' || form.type === 'inspect_device';
    if (isDeviceTask && !form.device_name) { setError('请选择目标设备'); return; }

    setError('');
    const delay = parseDurationFromInput(form.delay_hours, form.delay_minutes, form.delay_seconds);
    const body = {
      id: editingId,
      name: form.name,
      type: form.type,
      trigger_type: form.trigger_type,
      run_at: form.trigger_type === 'date' ? form.run_at : null,
      delay_seconds: form.trigger_type === 'duration' ? delay : 0,
      device_name: form.device_name,
      enabled: form.enabled,
    };
    try {
      const url = editingId ? '/api/schedule/update' : '/api/schedule/add';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        fetchSchedules();
      } else {
        setError(data.error || '保存失败');
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定要删除此调度任务吗？')) return;
    try {
      const res = await fetch(`/api/schedule/delete?id=${encodeURIComponent(id)}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) fetchSchedules();
    } catch { }
  };

  const handleToggle = async (sched: ScheduleItem) => {
    try {
      const res = await fetch('/api/schedule/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sched.id, enabled: !sched.enabled }),
      });
      const data = await res.json();
      if (data.success) fetchSchedules();
    } catch { }
  };

  const handleTrigger = async (id: string) => {
    try {
      const res = await fetch(`/api/schedule/trigger?id=${encodeURIComponent(id)}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert('任务已触发执行');
        fetchSchedules();
      } else {
        alert(data.error || '触发失败');
      }
    } catch { }
  };

  const formatTime = (t: string | null) => {
    if (!t) return '-';
    try {
      const d = new Date(t);
      return d.toLocaleString('zh-CN', { hour12: false });
    } catch { return t; }
  };

  const typeLabel = (type: string) => TASK_TYPES[type] || type;
  const isDeviceTask = form.type === 'backup_device' || form.type === 'inspect_device';

  return (
    <div className="scheduler-page" style={{ padding: '24px', color: '#e0e0e0', height: '100%', overflow: 'auto' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #333',
      }}>
        <div>
          <h2 style={{ margin: 0, color: '#4FC3F7', fontSize: '20px' }}>定时任务</h2>
          <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
            任务执行后自动移除，如需重复执行请再次添加
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="sched-btn primary" onClick={openAdd}>+ 添加任务</button>
          <button className="sched-btn" onClick={fetchSchedules}>刷新</button>
        </div>
      </div>

      <div style={{ background: '#2a2a3e', borderRadius: '8px', overflow: 'hidden' }}>
        <table className="sched-table">
          <thead>
            <tr>
              <th>任务名称</th>
              <th>类型</th>
              <th>执行时间</th>
              <th>目标设备</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && schedules.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: '#888' }}>加载中...</td></tr>
            )}
            {!loading && schedules.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                暂无定时任务
              </td></tr>
            )}
            {schedules.map(sched => (
              <tr key={sched.id}>
                <td style={{ fontWeight: 'bold' }}>{sched.name}</td>
                <td><span className="type-tag">{typeLabel(sched.type)}</span></td>
                <td style={{ fontSize: '12px', fontFamily: 'monospace' }}>
                  {sched.trigger_type === 'date'
                    ? (sched.next_run_time ? formatTime(sched.next_run_time) : (sched.run_at ? formatTime(sched.run_at) : '-'))
                    : `${formatDuration(sched.delay_seconds)} 后`}
                </td>
                <td style={{ fontSize: '12px', color: sched.device_name ? '#e0e0e0' : '#666' }}>
                  {sched.device_name || '-'}
                </td>
                <td>
                  <span className={`status-badge ${sched.enabled ? 'enabled' : 'disabled'}`}>
                    {sched.enabled ? '启用' : '禁用'}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <button className="action-btn" onClick={() => handleTrigger(sched.id)} title="立即执行">▶</button>
                    <button className="action-btn" onClick={() => {
                      const d = sched; openEdit(d);
                    }} title="编辑">✏️</button>
                    <button className="action-btn" onClick={() => handleToggle(sched)}
                      title={sched.enabled ? '禁用' : '启用'}>
                      {sched.enabled ? '⏸' : '▶️'}
                    </button>
                    <button className="action-btn danger" onClick={() => handleDelete(sched.id)} title="删除">🗑</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 添加/编辑弹窗 */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 20px', color: '#4FC3F7', fontSize: '16px' }}>
              {editingId ? '编辑定时任务' : '添加定时任务'}
            </h3>

            <div className="form-row">
              <label>任务名称</label>
              <input type="text" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="如：AR1 配置备份" />
            </div>

            <div className="form-row">
              <label>任务类型</label>
              <select value={form.type} onChange={e => {
                const t = e.target.value;
                setForm({ ...form, type: t, device_name: '' });
              }}>
                <option value="backup_all">全量备份</option>
                <option value="inspect_all">全量巡检</option>
                <option value="backup_device">指定设备备份</option>
                <option value="inspect_device">指定设备巡检</option>
              </select>
            </div>

            {isDeviceTask && (
              <div className="form-row">
                <label>目标设备</label>
                <select value={form.device_name} onChange={e => setForm({ ...form, device_name: e.target.value })}>
                  <option value="">-- 选择设备 --</option>
                  {devices.map(d => (
                    <option key={`${d.host}:${d.port}`} value={d.name}>
                      {d.name} ({d.host}) [{d.device_type}]
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-row">
              <label>触发方式</label>
              <div className="trigger-options">
                <label className="radio-label">
                  <input type="radio" name="trigger_type" value="date"
                    checked={form.trigger_type === 'date'}
                    onChange={() => setForm({ ...form, trigger_type: 'date' })} />
                  指定时间
                </label>
                <label className="radio-label">
                  <input type="radio" name="trigger_type" value="duration"
                    checked={form.trigger_type === 'duration'}
                    onChange={() => setForm({ ...form, trigger_type: 'duration' })} />
                  间隔时长
                </label>
              </div>
            </div>

            {form.trigger_type === 'date' ? (
              <div className="form-row">
                <label>执行时间</label>
                <input type="datetime-local" value={form.run_at.slice(0, 19)}
                  onChange={e => setForm({ ...form, run_at: e.target.value + ':00' })}
                  step="1" />
              </div>
            ) : (
              <div className="form-row">
                <label>延迟时长</label>
                <div className="duration-inputs">
                  <div className="duration-field">
                    <input type="number" min="0" placeholder="0" value={form.delay_hours}
                      onChange={e => setForm({ ...form, delay_hours: e.target.value })} />
                    <span>小时</span>
                  </div>
                  <div className="duration-field">
                    <input type="number" min="0" max="59" placeholder="0" value={form.delay_minutes}
                      onChange={e => setForm({ ...form, delay_minutes: e.target.value })} />
                    <span>分钟</span>
                  </div>
                  <div className="duration-field">
                    <input type="number" min="0" max="59" placeholder="0" value={form.delay_seconds}
                      onChange={e => setForm({ ...form, delay_seconds: e.target.value })} />
                    <span>秒</span>
                  </div>
                </div>
              </div>
            )}

            <div className="form-row">
              <label className="checkbox-label">
                <input type="checkbox" checked={form.enabled}
                  onChange={e => setForm({ ...form, enabled: e.target.checked })} />
                添加后立即启用
              </label>
            </div>

            {error && <div className="form-error">{error}</div>}

            <div className="form-actions">
              <button className="sched-btn" onClick={() => setShowModal(false)}>取消</button>
              <button className="sched-btn primary" onClick={handleSave}>
                {editingId ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .sched-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .sched-table th {
          padding: 10px 12px; text-align: left; background: #1e1e32;
          color: #888; font-weight: 600; font-size: 11px;
          border-bottom: 1px solid #3a3a5e;
        }
        .sched-table td { padding: 10px 12px; border-bottom: 1px solid #333; }
        .sched-table tr:hover td { background: #333350; }
        .type-tag {
          padding: 2px 8px; border-radius: 3px; font-size: 11px;
          background: #1a3a5a; color: #64B5F6;
        }
        .status-badge {
          padding: 2px 8px; border-radius: 10px; font-size: 11px;
        }
        .status-badge.enabled {
          background: #1b3a1b; color: #4CAF50; border: 1px solid #4CAF50;
        }
        .status-badge.disabled {
          background: #3a1b1b; color: #f44336; border: 1px solid #f44336;
        }
        .sched-btn {
          padding: 6px 14px; border-radius: 4px; border: 1px solid #4a4a6e;
          background: #3a3a5e; color: #e0e0e0; cursor: pointer; font-size: 12px;
          transition: background 0.2s;
        }
        .sched-btn:hover { background: #4a4a6e; }
        .sched-btn.primary { background: #1565C0; border-color: #1565C0; color: #fff; }
        .sched-btn.primary:hover { background: #1976D2; }
        .action-btn {
          padding: 2px 6px; border: none; background: none; color: #ccc;
          cursor: pointer; font-size: 14px; border-radius: 3px;
          transition: background 0.2s;
        }
        .action-btn:hover { background: #3a3a5e; }
        .action-btn.danger:hover { background: #3a1a1a; }
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.6);
          display: flex; align-items: center; justify-content: center; z-index: 1000;
        }
        .modal-content {
          background: #2a2a3e; border-radius: 12px; padding: 24px;
          width: 480px; max-width: 90vw; max-height: 80vh; overflow-y: auto;
          border: 1px solid #3a3a5e;
        }
        .form-row { margin-bottom: 16px; }
        .form-row label {
          display: block; font-size: 12px; color: #aaa; margin-bottom: 4px;
        }
        .form-row input[type="text"],
        .form-row input[type="datetime-local"],
        .form-row select {
          width: 100%; padding: 8px 10px; background: #1e1e32; color: #e0e0e0;
          border: 1px solid #3a3a5e; border-radius: 4px; font-size: 13px;
          box-sizing: border-box;
        }
        .form-row input[type="datetime-local"]::-webkit-calendar-picker-indicator {
          filter: invert(0.7); cursor: pointer;
        }
        .trigger-options { display: flex; gap: 24px; padding-top: 4px; }
        .radio-label {
          display: flex !important; align-items: center; gap: 6px;
          cursor: pointer; color: #e0e0e0 !important;
        }
        .radio-label input { width: auto; }
        .checkbox-label {
          display: flex !important; align-items: center; gap: 8px;
          cursor: pointer; color: #e0e0e0 !important;
        }
        .checkbox-label input { width: auto; }
        .duration-inputs { display: flex; gap: 12px; }
        .duration-field { display: flex; align-items: center; gap: 6px; }
        .duration-field input[type="number"] {
          width: 80px; padding: 8px 10px; background: #1e1e32; color: #e0e0e0;
          border: 1px solid #3a3a5e; border-radius: 4px; font-size: 13px;
          box-sizing: border-box; text-align: center;
        }
        .duration-field span { font-size: 12px; color: #888; }
        .form-error {
          color: #f44336; padding: 8px 12px; background: #2a1a1a;
          border-radius: 4px; font-size: 13px; margin-bottom: 12px;
          border: 1px solid #4a1a1a;
        }
        .form-actions {
          display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px;
        }
      `}</style>
    </div>
  );
};

export default TaskScheduler;
