from typing import List, Optional

from pydantic import BaseModel


class SandboxLLMRequest(BaseModel):
    model: str
    prompt: str
    temperature: Optional[float] = 0.7
    web_search: Optional[bool] = False


class SandboxVLMRequest(BaseModel):
    model: str
    prompt: str
    images: List[str]


class SandboxT2IRequest(BaseModel):
    model: str
    prompt: str
    style: Optional[str] = "anime"
    ratio: Optional[str] = "16:9"
    # 画质档位（720P / 1080P / 2K）或自定义尺寸「宽*高」；留空用默认 2K
    resolution: Optional[str] = None
    # 输出格式 png / jpeg / webp；留空保持模型原样
    output_format: Optional[str] = None


class SandboxI2IRequest(BaseModel):
    model: str
    prompt: str
    image: str
    ratio: Optional[str] = "16:9"
    resolution: Optional[str] = None
    output_format: Optional[str] = None


class SandboxVideoRequest(BaseModel):
    model: str
    prompt: str
    image: Optional[str] = None
