"""API 路由"""
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import AsyncIterator
from .schemas import (
    ChatRequest,
    ChatResponse,
    StreamChatRequest,
    SessionInfo,
    ErrorResponse,
)
from agent import agent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["Agent"])


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """基础对话接口"""
    try:
        # 获取或创建会话
        session_id = request.session_id
        if session_id:
            session = agent.get_session(session_id)
            if not session:
                raise HTTPException(status_code=404, detail="Session not found")
        else:
            session = agent.create_session()
            session_id = session.session_id
        
        # 处理对话
        result = await agent.chat(session_id, request.message)
        
        return ChatResponse(
            response=result["response"],
            session_id=result["session_id"],
            tools_used=result.get("tools_used", []),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stream")
async def stream_chat(request: StreamChatRequest):
    """流式对话接口"""
    async def generate():
        try:
            # 获取或创建会话
            session_id = request.session_id
            if session_id:
                session = agent.get_session(session_id)
                if not session:
                    session = agent.create_session()
                    session_id = session.session_id
            else:
                session = agent.create_session()
                session_id = session.session_id
            
            # 发送 session_id
            yield f"data: {{'session_id': '{session_id}', 'type': 'start'}}\n\n"
            
            # 流式发送响应
            full_response = ""
            async for chunk in agent.chat_stream(session_id, request.message):
                full_response += chunk
                # 清理 chunk 中的换行符
                chunk_clean = chunk.replace("\n", "\\n")
                yield f"data: {{'content': '{chunk_clean}', 'type': 'chunk'}}\n\n"
            
            # 发送完成
            yield f"data: {{'type': 'end'}}\n\n"
            
        except Exception as e:
            logger.error(f"Stream error: {e}")
            error_msg = str(e).replace("'", "\\'").replace("\n", " ")
            yield f"data: {{'type': 'error', 'error': '{error_msg}'}}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/session/{session_id}", response_model=SessionInfo)
async def get_session(session_id: str) -> SessionInfo:
    """获取会话信息"""
    session = agent.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return SessionInfo(
        session_id=session.session_id,
        user_id=session.user_id,
        message_count=len(session.messages),
        created_at=session.created_at.isoformat(),
    )
