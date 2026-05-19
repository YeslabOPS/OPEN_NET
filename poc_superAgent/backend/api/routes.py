"""API 路由"""
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import AsyncIterator
from .schemas import (
    ChatRequest,
    ChatResponse,
    StreamChatRequest,
    PlanRequest,
    PlanResponse,
    SessionInfo,
    DocumentInfo,
    KnowledgeCompileResponse,
    KnowledgeQueryRequest,
    KnowledgeQueryResponse,
    ErrorResponse,
)
from agent import agent
from agent.planner import planner
from knowledge import wiki_engine, rag_engine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["Agent"])


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """基础对话接口"""
    try:
        session_id = request.session_id
        if session_id:
            session = agent.get_session(session_id)
            if not session:
                raise HTTPException(status_code=404, detail="Session not found")
        else:
            session = agent.create_session()
            session_id = session.session_id
        
        result = await agent.chat(session_id, request.message)
        
        return ChatResponse(
            response=result["response"],
            session_id=result["session_id"],
            tools_used=result.get("tools_used", []),
            plan=result.get("plan"),
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
            session_id = request.session_id
            if session_id:
                session = agent.get_session(session_id)
                if not session:
                    session = agent.create_session()
                    session_id = session.session_id
            else:
                session = agent.create_session()
                session_id = session.session_id
            
            yield f"data: {{'session_id': '{session_id}', 'type': 'start'}}\n\n"
            
            full_response = ""
            async for chunk in agent.chat_stream(session_id, request.message):
                full_response += chunk
                chunk_clean = chunk.replace("\n", "\\n")
                yield f"data: {{'content': '{chunk_clean}', 'type': 'chunk'}}\n\n"
            
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


# ── 任务规划路由 ──

@router.post("/plan", response_model=PlanResponse)
async def plan_task(request: PlanRequest) -> PlanResponse:
    """规划并执行任务"""
    result = await agent.plan_and_execute(request.message)
    return PlanResponse(
        plan=result["plan"],
        summary=result["summary"],
        is_inspection=result["is_inspection"],
    )


# ── 知识库路由 ──

@router.get("/knowledge/list", response_model=list[DocumentInfo])
async def list_documents():
    """列出知识库文档"""
    docs = wiki_engine.list_documents()
    return [
        DocumentInfo(
            id=doc["id"],
            title=doc["title"],
            compiled=doc.get("compiled", False),
            compiled_path=doc.get("compiled_path", ""),
            created_at=doc.get("created_at", ""),
            tags=doc.get("tags", []),
        )
        for doc in docs
    ]


@router.post("/knowledge/compile")
async def compile_all_documents():
    """编译所有文档"""
    results = await wiki_engine.compile_all()
    return {"results": results}


@router.post("/knowledge/compile/{doc_id}", response_model=KnowledgeCompileResponse)
async def compile_document(doc_id: str):
    """编译单个文档"""
    result = await wiki_engine.compile_one(doc_id)
    return KnowledgeCompileResponse(**result)


@router.post("/knowledge/query", response_model=KnowledgeQueryResponse)
async def query_knowledge(request: KnowledgeQueryRequest):
    """查询知识库"""
    # RAG 检索
    rag_results = rag_engine.query(request.question, top_k=3)
    
    # Wiki 引擎回答
    answer = await wiki_engine.query(request.question)
    
    return KnowledgeQueryResponse(
        answer=answer,
        sources=[
            {
                "doc_id": r["metadata"]["doc_id"],
                "content": r["content"][:200],
                "distance": r.get("distance", 0),
            }
            for r in rag_results
        ],
    )


@router.get("/knowledge/wiki/{doc_id}")
async def get_wiki_content(doc_id: str):
    """获取编译后的 Wiki 内容"""
    content = wiki_engine.get_wiki_content(doc_id)
    if not content:
        raise HTTPException(status_code=404, detail="Wiki content not found")
    return {"id": doc_id, "content": content}


@router.post("/knowledge/index")
async def index_wiki():
    """重新索引 Wiki"""
    wiki_dir = os.path.join(
        __import__("config").settings.knowledge_base_path,
        "wiki",
        "compiled",
    )
    indexed = rag_engine.index_wiki(wiki_dir)
    return {"indexed_count": indexed, "total_chunks": rag_engine.count()}


@router.post("/knowledge/clear")
async def clear_index():
    """清空索引"""
    rag_engine.clear_all()
    return {"status": "cleared"}
