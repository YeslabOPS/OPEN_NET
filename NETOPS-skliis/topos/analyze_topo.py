"""分析拓扑并调用 AI 助手"""
import sys, json, urllib.request, os

PROJECT = 'f:/4期IP/录播/NETOPS'
sys.path.insert(0, PROJECT)

from api.ensp_parser import load_topo

# 1. 解析拓扑
topo_file = os.path.join(PROJECT, 'topos', '1223_copied.topo')
result = load_topo(topo_file)
data = result['data']

print('=' * 60)
print('  [AI 运维助手] 拓扑文件解析结果')
print('=' * 60)
print()

for d in data['devices']:
    name = d['name']
    model = d['model']
    dtype = d['device_type']
    port = d['com_port']
    ifaces = ', '.join(d['interfaces'])
    print(f'  [{dtype}] {name} ({model}) - com_port={port}')
    print(f'    接口: {ifaces}')
print()

print('  连接关系:')
for c in data['connections']:
    print(f'    {c["device_a"]}.{c["interface_a"]}  <-->  {c["device_b"]}.{c["interface_b"]}')
print()

total_devs = data['summary']['devices_count']
total_conns = data['summary']['connections_count']
print(f'  总计: {total_devs} 台设备, {total_conns} 条连接')
print()

# 2. 调用 AI 助手 API 分析
print('=' * 60)
print('  [AI 运维助手] 调用 AI 进行拓扑分析...')
print('=' * 60)
print()

try:
    # 通过 runner.py 加载拓扑到缓存，这样 AI 工具可以获取
    import subprocess
    r = subprocess.run([sys.executable, os.path.join(PROJECT, 'api', 'runner.py'),
        'ensp_load_topology', topo_file],
        capture_output=True, text=True, timeout=10)
    load_out = r.stdout
    s = load_out.find('{')
    e = load_out.rfind('}')
    if s >= 0 and e > s:
        load_result = json.loads(load_out[s:e+1])
        print(f'  拓扑加载: {"[OK]" if load_result.get("success") else "[FAIL]"}')

    # 获取设备列表（验证工具可用）
    r = subprocess.run([sys.executable, os.path.join(PROJECT, 'api', 'runner.py'),
        'ensp_list_devices'],
        capture_output=True, text=True, timeout=10)
    dev_out = r.stdout
    s = dev_out.find('{')
    e = dev_out.rfind('}')
    if s >= 0 and e > s:
        dev_result = json.loads(dev_out[s:e+1])
        devs = dev_result.get('data', [])
        print(f'  设备列表: {len(devs)} 台')
        for dev in devs:
            print(f'    - {dev["name"]} ({dev["model"]}) [{dev["device_type"]}]')

    # 调用 AI 聊天 API
    payload = json.dumps({
        "messages": [
            {"role": "user", "content": "请分析这个拓扑文件，告诉我网络结构、设备角色和配置建议。先调用 ensp_load_topology 加载拓扑，再调用 ensp_list_devices 获取设备列表。"}
        ],
        "loaded_topo": topo_file,
    }).encode()
    req = urllib.request.Request(
        'http://127.0.0.1:3001/api/ai/chat',
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        ai_result = json.loads(resp.read().decode())
        reply = ai_result.get('data', '') if ai_result.get('success') else ai_result.get('error', '')
        tool_calls = ai_result.get('tool_calls', [])
        print()
        print('  AI 分析结果:')
        print('  ' + '-' * 40)
        if reply:
            for line in reply.split('\n'):
                print(f'  {line}')
        elif tool_calls:
            print(f'  (AI 触发 Function Calling...)')
            for tc in tool_calls:
                print(f'    工具: {tc.get("name", "?")} 参数: {json.dumps(tc.get("arguments",{}), ensure_ascii=False)[:100]}')
        else:
            print(f'  (AI 返回: {json.dumps(ai_result, ensure_ascii=False)[:500]})')
    except urllib.request.HTTPError as e:
        print(f'  AI API HTTP 错误: {e.code} {e.reason}')
        body = e.read().decode()
        print(f'  响应: {body[:500]}')
    except Exception as e:
        print(f'  AI API 调用失败: {e}')

except Exception as e:
    print(f'  错误: {e}')

print()
print('=' * 60)
print('  分析完成')
print('=' * 60)
