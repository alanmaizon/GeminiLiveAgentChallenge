from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    gemini_api_key: Optional[str] = None
    gemini_model: str = "gemini-2.0-flash-live-001"
    mock_mode: bool = False
    allowed_origins: str = "http://localhost:3000"
    gcp_project_id: Optional[str] = None

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()

# Use mock mode if explicitly set or no API key is available
USE_MOCK = settings.mock_mode or not settings.gemini_api_key
