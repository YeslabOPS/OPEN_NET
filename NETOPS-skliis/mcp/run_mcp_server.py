"""
eNSP MCP Server 启动器
解决 Python 模块路径问题
"""
import sys
import os

# 添加项目根目录到 Python 路径（用于导入 core/ 模块）
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

# 添加 ensp 源码目录到 Python 路径
ensp_src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ensp", "src")
sys.path.insert(0, ensp_src)

from ensp.server import run

if __name__ == "__main__":
    run()
