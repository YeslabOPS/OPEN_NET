# 后端环境配置
mkdir backend

## 配置虚拟环境
python -m venv .venv
cd .venv\Scripts
.\activate.bat
cd ..\..

```powershell
pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/
pip install uv
```

## 验证安装

```powershell
uv --version
```

预期输出：
```
uv 0.x.x
```
## 初始化项目
cd backend
uv init
cd ..

## 项目的uv配置国内源
在backend\pyproject.toml中加入
```
[[tool.uv.index]]
url = "https://mirrors.aliyun.com/pypi/simple/"
default = true
```

# 前端环境配置
mkdir frontend

访问 [Node.js 官网下载页面](https://nodejs.org/)

## 验证安装

```powershell
node --version
npm --version
```

预期输出：
```
v20.x.x
10.x.x
```

## npm配置国内源

```powershell
npm config set registry https://registry.npmmirror.com
```

### 验证配置

```powershell
npm config get registry
```

预期输出：
```
https://registry.npmmirror.com
```

