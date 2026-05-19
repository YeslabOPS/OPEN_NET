"""项目配置"""
import logging
from pydantic_settings import BaseSettings, SettingsConfigDict


def setup_logging(log_level: str = "INFO"):
    """配置日志"""
    logging.basicConfig(
        level=getattr(logging, log_level.upper()),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


class Settings(BaseSettings):
    """应用配置"""
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

    # DeepSeek API 配置
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"

    # 应用配置
    app_name: str = "Super Agent"
    log_level: str = "INFO"

    # 知识库配置
    knowledge_base_path: str = "./knowledge_base"

    # SSH 配置
    ssh_timeout: int = 10
    ssh_max_retries: int = 2

    # LLM 配置
    llm_timeout: int = 60
    llm_max_tokens: int = 2048


# 全局配置实例
settings = Settings()
setup_logging(settings.log_level)

# 获取 logger
logger = logging.getLogger(__name__)
