"""Super Agent 后端入口"""
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from config import settings
from api import router
from api.device_routes import router as device_router

# 配置日志
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)

# 创建 FastAPI 应用
app = FastAPI(
    title=settings.app_name,
    description="网络巡检场景 Super Agent API",
    version="0.1.0",
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 开发环境全放通
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 统一异常处理 ──

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """全局异常处理"""
    logger.error(f"Unhandled error on {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "服务器内部错误",
            "detail": str(exc)[:200],
        },
    )


# ── 路由注册 ──

app.include_router(router)
app.include_router(device_router)


# ── 基础端点 ──

@app.get("/")
async def root():
    """根路径"""
    return {
        "name": settings.app_name,
        "version": "0.1.0",
        "status": "running",
        "endpoints": {
            "agent": "/api/agent/chat",
            "plan": "/api/agent/plan",
            "stream": "/api/agent/stream",
            "knowledge": "/api/agent/knowledge/list",
            "devices": "/api/devices",
            "health": "/health",
        },
    }


@app.get("/health")
async def health():
    """健康检查"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
