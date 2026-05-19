import React, { useRef, useEffect, useState, useCallback } from 'react';
import { api, ApiResponse } from '../api';

interface TopoDevice {
  id: string;
  name: string;
  model: string;
  device_type: string;
  is_configurable: boolean;
  com_port: number;
  interfaces: string[];
  position: { x: number; y: number };
}

interface TopoConnection {
  device_a: string;
  device_b: string;
  interface_a: string;
  interface_b: string;
  line_type: string;
}

interface TopologyData {
  source_file: string;
  version: string;
  devices: TopoDevice[];
  connections: TopoConnection[];
  labels: { content: string; position: { left: string; top: string } }[];
  summary: {
    devices_count: number;
    connections_count: number;
    configurable_devices: number;
    labels_count: number;
  };
}

interface TopoFileInfo {
  filename: string;
  path: string;
  size: number;
  modified: number;
}

// 设备类型颜色映射
const DEVICE_COLORS: Record<string, { background: string; border: string }> = {
  router: { background: '#2196F3', border: '#1565C0' },
  switch: { background: '#4CAF50', border: '#2E7D32' },
  firewall: { background: '#f44336', border: '#c62828' },
  wireless: { background: '#FF9800', border: '#E65100' },
  endpoint: { background: '#9E9E9E', border: '#616161' },
  cloud: { background: '#9C27B0', border: '#6A1B9A' },
  unknown: { background: '#607D8B', border: '#37474F' },
};

// 设备类型形状映射
const DEVICE_SHAPES: Record<string, string> = {
  router: 'triangle',
  switch: 'square',
  firewall: 'diamond',
  wireless: 'star',
  endpoint: 'dot',
  cloud: 'hexagon',
  unknown: 'ellipse',
};

const NetworkTopology: React.FC = () => {
  const networkRef = useRef<HTMLDivElement>(null);
  const networkInstance = useRef<any>(null);
  const [topoData, setTopoData] = useState<TopologyData | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<TopoDevice | null>(null);
  const [topoFiles, setTopoFiles] = useState<TopoFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 加载拓扑数据
  const loadTopology = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/topo/info');
      const data: ApiResponse<TopologyData> = await res.json();
      if (data.success && data.data) {
        setTopoData(data.data);
      } else {
        setError(data.error || '未加载拓扑文件');
        setTopoData(null);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载拓扑文件列表
  const loadTopoFiles = useCallback(async () => {
    try {
      const res = await fetch('/api/topo/list');
      const data: ApiResponse<TopoFileInfo[]> = await res.json();
      if (data.success && data.data) {
        setTopoFiles(data.data);
      }
    } catch { }
  }, []);

  // 选择并加载拓扑文件
  const handleSelectFile = async (filename: string, filepath: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/topo/load?filepath=${encodeURIComponent(filepath)}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        await loadTopology();
      } else {
        setError(data.error || '拓扑解析失败');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 渲染拓扑图（vis-network）
  useEffect(() => {
    if (!topoData || !networkRef.current || typeof window === 'undefined') return;

    // 动态导入 vis-network
    const renderNetwork = async () => {
      const vis = await import('vis-network');
      const { DataSet } = await import('vis-data');

      const nodes = new DataSet(topoData.devices.map(d => {
        const colors = DEVICE_COLORS[d.device_type] || DEVICE_COLORS.unknown;
        const shape = DEVICE_SHAPES[d.device_type] || 'ellipse';
        return {
          id: d.name,
          label: d.name,
          title: `<b>${d.name}</b><br>型号: ${d.model}<br>类型: ${d.device_type}<br>接口数: ${d.interfaces.length}`,
          shape,
          color: { background: colors.background, border: colors.border },
          font: { color: '#fff', size: 12, face: 'monospace' },
          size: shape === 'dot' ? 20 : 30,
          x: d.position?.x || undefined,
          y: d.position?.y || undefined,
        };
      }));

      const edges = new DataSet(topoData.connections.map((c, i) => ({
        id: i,
        from: c.device_a,
        to: c.device_b,
        label: `${c.interface_a} - ${c.interface_b}`,
        font: { size: 10, color: '#aaa', strokeWidth: 0 },
        color: { color: '#666', highlight: '#4FC3F7', hover: '#4FC3F7' },
        width: 1.5,
        smooth: { enabled: true, type: 'curvedCW', roundness: 0.1 },
        title: `${c.device_a}:${c.interface_a} ↔ ${c.device_b}:${c.interface_b}`,
      })));

      const options: any = {
        physics: {
          enabled: true,
          solver: 'forceAtlas2Based',
          forceAtlas2Based: {
            gravitationalConstant: -80,
            centralGravity: 0.005,
            springLength: 200,
            springConstant: 0.02,
            damping: 0.4,
          },
          stabilization: { iterations: 200 },
        },
        layout: { improvedLayout: true },
        interaction: {
          hover: true,
          tooltipDelay: 200,
          zoomView: true,
          dragView: true,
          dragNodes: true,
          multiselect: false,
        },
        edges: {
          smooth: true,
          arrows: { to: { enabled: false }, from: { enabled: false } },
        },
        nodes: {
          borderWidth: 2,
          borderWidthSelected: 3,
          chosen: { node: (values: any) => { values.borderWidth = 3; } },
        },
        groups: {
          router: { shape: 'triangle', color: DEVICE_COLORS.router },
          switch: { shape: 'square', color: DEVICE_COLORS.switch },
          firewall: { shape: 'diamond', color: DEVICE_COLORS.firewall },
          endpoint: { shape: 'dot', color: DEVICE_COLORS.endpoint },
        },
        backgroundColor: '#1a1a2e',
      };

      if (networkRef.current) {
        const container = networkRef.current;
        // 清空
        container.innerHTML = '';

        try {
          const network = new vis.Network(container, { nodes, edges }, options);
          networkInstance.current = network;

          // 物理布局稳定后关闭模拟
          network.once('stabilizationIterationsDone', () => {
            network.setOptions({ physics: { enabled: false } });
          });

          // 节点点击事件
          network.on('click', (params: any) => {
            if (params.nodes && params.nodes.length > 0) {
              const nodeId = params.nodes[0];
              const device = topoData.devices.find(d => d.name === nodeId);
              setSelectedDevice(device || null);
            } else {
              setSelectedDevice(null);
            }
          });
        } catch (e) {
          console.error('vis-network 渲染失败:', e);
        }
      } else {
        console.log('networkRef.current is null');
      }
    };

    renderNetwork();

    return () => {
      if (networkInstance.current) {
        networkInstance.current.destroy();
        networkInstance.current = null;
      }
    };
  }, [topoData]);

  // 初始加载
  useEffect(() => {
    loadTopology();
    loadTopoFiles();
  }, [loadTopology, loadTopoFiles]);

  return (
    <div className="topology-page" style={{ display: 'flex', height: '100%', color: '#e0e0e0' }}>
      {/* 左侧画布 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 工具栏 */}
        <div style={{
          padding: '8px 16px', background: '#2a2a3e', borderBottom: '1px solid #3a3a5e',
          display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
        }}>
          <span style={{ fontWeight: 'bold', color: '#4FC3F7' }}>网络拓扑</span>
          <div style={{ flex: 1 }} />
          {topoFiles.length > 0 && (
            <select
              style={{
                padding: '4px 8px', background: '#1e1e32', color: '#e0e0e0',
                border: '1px solid #3a3a5e', borderRadius: '4px', fontSize: '12px',
              }}
              onChange={(e) => {
                const file = topoFiles.find(f => f.filename === e.target.value);
                if (file) handleSelectFile(file.filename, file.path);
              }}
              defaultValue=""
            >
              <option value="" disabled>选择拓扑文件...</option>
              {topoFiles.map(f => (
                <option key={f.filename} value={f.filename}>{f.filename}</option>
              ))}
            </select>
          )}
          <button className="toolbar-btn" onClick={loadTopology} title="刷新拓扑">
            🔄 刷新
          </button>
          <button className="toolbar-btn" onClick={() => {
            if (networkInstance.current) {
              networkInstance.current.setOptions({ physics: { enabled: true } });
              networkInstance.current.once('stabilizationIterationsDone', () => {
                networkInstance.current.setOptions({ physics: { enabled: false } });
              });
            }
          }} title="自动布局">
            📐 布局
          </button>
          <button className="toolbar-btn" onClick={() => {
            if (networkInstance.current) {
              networkInstance.current.zoomExtent({ animation: true });
            }
          }} title="自适应">
            🔍 适应
          </button>
        </div>

        {/* 画布 */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {loading && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', background: 'rgba(0,0,0,0.5)', zIndex: 10,
            }}>
              <div style={{ color: '#4FC3F7' }}>加载中...</div>
            </div>
          )}
          {error && !topoData && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '100%', color: '#888',
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🗺️</div>
              <div>{error}</div>
              <div style={{ fontSize: '12px', marginTop: '8px', color: '#666' }}>
                请先上传 .topo 拓扑文件
              </div>
            </div>
          )}
          <div
            ref={networkRef}
            style={{ width: '100%', height: '100%', background: '#1a1a2e' }}
          />
          {/* 图例 */}
          <div style={{
            position: 'absolute', bottom: '16px', left: '16px',
            background: 'rgba(0,0,0,0.7)', padding: '8px 12px', borderRadius: '6px',
            fontSize: '11px', display: 'flex', gap: '12px', flexWrap: 'wrap',
          }}>
            {Object.entries(DEVICE_COLORS).map(([type, colors]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{
                  width: '10px', height: '10px', borderRadius: '50%',
                  background: colors.background, border: `2px solid ${colors.border}`,
                  display: 'inline-block',
                }} />
                <span style={{ color: '#aaa' }}>{type}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 右侧详情面板 */}
      {selectedDevice && (
        <div style={{
          width: '300px', background: '#2a2a3e', borderLeft: '1px solid #3a3a5e',
          overflowY: 'auto', padding: '16px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, color: '#4FC3F7' }}>{selectedDevice.name}</h3>
            <button
              onClick={() => setSelectedDevice(null)}
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '18px' }}
            >✕</button>
          </div>
          <div className="device-detail-section">
            <div className="detail-label">型号</div>
            <div className="detail-value">{selectedDevice.model}</div>
          </div>
          <div className="device-detail-section">
            <div className="detail-label">类型</div>
            <div className="detail-value" style={{
              color: (DEVICE_COLORS[selectedDevice.device_type] || DEVICE_COLORS.unknown).background,
            }}>{selectedDevice.device_type}</div>
          </div>
          <div className="device-detail-section">
            <div className="detail-label">COM 口</div>
            <div className="detail-value">{selectedDevice.com_port || '无'}</div>
          </div>
          <div className="device-detail-section">
            <div className="detail-label">可配置</div>
            <div className="detail-value">{selectedDevice.is_configurable ? '是' : '否'}</div>
          </div>
          <div style={{ marginTop: '16px' }}>
            <div className="detail-label" style={{ marginBottom: '8px' }}>接口列表 ({selectedDevice.interfaces.length})</div>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {selectedDevice.interfaces.map((iface, i) => (
                <div key={i} style={{
                  padding: '4px 8px', marginBottom: '2px', background: '#1e1e32',
                  borderRadius: '4px', fontSize: '12px', fontFamily: 'monospace',
                }}>
                  {iface}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Styles */}
      <style>{`
        .toolbar-btn {
          padding: 4px 12px;
          background: #3a3a5e;
          color: #e0e0e0;
          border: 1px solid #4a4a6e;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: background 0.2s;
        }
        .toolbar-btn:hover { background: #4a4a6e; }
        .device-detail-section {
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid #3a3a5e;
        }
        .detail-label {
          font-size: 11px;
          color: #888;
          text-transform: uppercase;
          margin-bottom: 2px;
        }
        .detail-value {
          font-size: 14px;
          color: #e0e0e0;
        }
      `}</style>
    </div>
  );
};

export default NetworkTopology;
