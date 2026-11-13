"""画布与作品图库：上传到画布的图片、画布内容保存、作品批量导出。"""

import io
import json
import logging
import os
import uuid
import re
import zipfile
from pathlib import Path
from typing import Any, List

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from api.routers.files import _save_upload
from config import settings
from path_security import resolve_allowed_local_file

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Canvas"])

CANVAS_UPLOAD_DIR = os.path.join(settings.CODE_DIR, "result", "canvas", "uploads")
CANVAS_BOARD_FILE = os.path.join(settings.CODE_DIR, "data", "canvas", "board.json")
RESULT_DIR = os.path.join(settings.CODE_DIR, "result")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
IMAGE_UPLOAD_LIMIT = 30 * 1024 * 1024
BOARD_SIZE_LIMIT = 5 * 1024 * 1024
EXPORT_MAX_FILES = 200


class CanvasBoard(BaseModel):
    shapes: List[dict[str, Any]] = []
    camera: dict[str, float] | None = None


class GalleryExportRequest(BaseModel):
    paths: List[str]


class BrandKit(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    style_words: str = Field(default="", max_length=300)
    colors: List[str] = Field(default_factory=list, max_length=5)
    anchor_image: str = ""


class SavedPrompt(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


BRAND_KITS_FILE = os.path.join(settings.CODE_DIR, "data", "canvas", "brand_kits.json")
PROMPTS_FILE = os.path.join(settings.CODE_DIR, "data", "canvas", "prompts.json")
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_BRAND_KITS = 50
MAX_SAVED_PROMPTS = 100


def _read_list(path: str) -> List[dict]:
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        logger.warning("Failed to read %s", path, exc_info=True)
        return []


def _write_list(path: str, items: List[dict]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{uuid.uuid4().hex}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def normalize_brand_kit(kit: BrandKit) -> dict:
    colors = [c.lower() for c in kit.colors if HEX_COLOR.match(c or "")]
    anchor = (kit.anchor_image or "").strip()
    if anchor:
        try:
            resolve_export_paths([anchor])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"风格锚点图无效：{exc}") from exc
        if anchor.startswith("/code/"):
            anchor = anchor[len("/code/"):]
    return {
        "name": kit.name.strip(),
        "style_words": kit.style_words.strip(),
        "colors": colors,
        "anchor_image": anchor,
    }


def _code_relative(path: str) -> str:
    return Path(path).resolve().relative_to(Path(settings.CODE_DIR).resolve()).as_posix()


@router.post("/api/canvas/upload")
async def canvas_upload(file: UploadFile = File(...)):
    """把图片放到画布上：存进 result/canvas/uploads，既能显示也能作为参考图。"""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="只支持 JPG、PNG、WebP、BMP 图片")
    os.makedirs(CANVAS_UPLOAD_DIR, exist_ok=True)
    destination = os.path.join(CANVAS_UPLOAD_DIR, f"{uuid.uuid4().hex}{ext}")
    await _save_upload(file, destination, IMAGE_UPLOAD_LIMIT)
    return {"path": _code_relative(destination), "filename": file.filename}


@router.get("/api/canvas/board")
async def canvas_get_board():
    if not os.path.exists(CANVAS_BOARD_FILE):
        return {"shapes": [], "camera": None}
    try:
        with open(CANVAS_BOARD_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        logger.warning("Failed to read canvas board", exc_info=True)
        return {"shapes": [], "camera": None}


@router.put("/api/canvas/board")
async def canvas_save_board(board: CanvasBoard):
    data = board.model_dump()
    text = json.dumps(data, ensure_ascii=False)
    if len(text.encode("utf-8")) > BOARD_SIZE_LIMIT:
        raise HTTPException(status_code=413, detail="画布内容过大")
    os.makedirs(os.path.dirname(CANVAS_BOARD_FILE), exist_ok=True)
    tmp = f"{CANVAS_BOARD_FILE}.{uuid.uuid4().hex}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, CANVAS_BOARD_FILE)
    return {"status": "ok"}


def resolve_export_paths(paths: List[str]) -> List[str]:
    """只允许导出 result/ 下已存在的图片；其余路径直接拒绝。"""
    if not paths:
        raise ValueError("请至少选择一张作品")
    if len(paths) > EXPORT_MAX_FILES:
        raise ValueError(f"一次最多导出 {EXPORT_MAX_FILES} 张")
    resolved: List[str] = []
    for raw in paths:
        value = str(raw or "").strip()
        for prefix in ("/code/", "result/"):
            if value.startswith(prefix):
                value = value[len(prefix):]
        if not value or Path(value).is_absolute():
            raise ValueError("文件不存在或不在允许的目录中")
        full = resolve_allowed_local_file(value, [RESULT_DIR])
        if os.path.splitext(full)[1].lower() not in IMAGE_EXTS:
            raise ValueError("只能导出图片")
        resolved.append(full)
    return resolved


@router.post("/api/gallery/export")
async def gallery_export(req: GalleryExportRequest):
    try:
        files = resolve_export_paths(req.paths)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    buffer = io.BytesIO()
    used: set[str] = set()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for index, path in enumerate(files, start=1):
            name = os.path.basename(path)
            if name in used:
                name = f"{index:03d}_{name}"
            used.add(name)
            zf.write(path, arcname=name)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="gallery-export.zip"'},
    )


@router.get("/api/canvas/brand-kits")
async def list_brand_kits():
    return {"kits": _read_list(BRAND_KITS_FILE)}


@router.post("/api/canvas/brand-kits")
async def create_brand_kit(kit: BrandKit):
    kits = _read_list(BRAND_KITS_FILE)
    if len(kits) >= MAX_BRAND_KITS:
        raise HTTPException(status_code=400, detail=f"最多保存 {MAX_BRAND_KITS} 个品牌套件")
    record = {"id": uuid.uuid4().hex[:10], **normalize_brand_kit(kit)}
    kits.insert(0, record)
    _write_list(BRAND_KITS_FILE, kits)
    return record


@router.put("/api/canvas/brand-kits/{kit_id}")
async def update_brand_kit(kit_id: str, kit: BrandKit):
    kits = _read_list(BRAND_KITS_FILE)
    for index, item in enumerate(kits):
        if item.get("id") == kit_id:
            kits[index] = {"id": kit_id, **normalize_brand_kit(kit)}
            _write_list(BRAND_KITS_FILE, kits)
            return kits[index]
    raise HTTPException(status_code=404, detail="品牌套件不存在")


@router.delete("/api/canvas/brand-kits/{kit_id}")
async def delete_brand_kit(kit_id: str):
    kits = _read_list(BRAND_KITS_FILE)
    remaining = [item for item in kits if item.get("id") != kit_id]
    if len(remaining) == len(kits):
        raise HTTPException(status_code=404, detail="品牌套件不存在")
    _write_list(BRAND_KITS_FILE, remaining)
    return {"status": "ok"}


@router.get("/api/canvas/prompts")
async def list_saved_prompts():
    return {"prompts": _read_list(PROMPTS_FILE)}


@router.post("/api/canvas/prompts")
async def save_prompt(prompt: SavedPrompt):
    prompts = _read_list(PROMPTS_FILE)
    text = prompt.text.strip()
    existing = next((item for item in prompts if item.get("text") == text), None)
    if existing:
        return existing
    if len(prompts) >= MAX_SAVED_PROMPTS:
        raise HTTPException(status_code=400, detail=f"最多保存 {MAX_SAVED_PROMPTS} 条常用提示词")
    record = {"id": uuid.uuid4().hex[:10], "text": text}
    prompts.insert(0, record)
    _write_list(PROMPTS_FILE, prompts)
    return record


@router.delete("/api/canvas/prompts/{prompt_id}")
async def delete_saved_prompt(prompt_id: str):
    prompts = _read_list(PROMPTS_FILE)
    _write_list(PROMPTS_FILE, [item for item in prompts if item.get("id") != prompt_id])
    return {"status": "ok"}


@router.post("/api/providers/runninghub/account")
async def runninghub_account():
    """核查 RunningHub 账号：Key 是否可用、剩余额度。不会发起任何生成任务。"""
    from fastapi.concurrency import run_in_threadpool
    from models.video_runninghub import RunningHubError, RunningHubVideoClient

    try:
        data = await run_in_threadpool(RunningHubVideoClient().account_status)
    except RunningHubError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("RunningHub account check failed", exc_info=True)
        raise HTTPException(status_code=502, detail=f"连接 RunningHub 失败：{exc}") from exc
    return {"account": data}


RUNNINGHUB_RESULT_DIR = os.path.join(settings.CODE_DIR, "result", "runninghub")
RUNNINGHUB_RATIOS = {"1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "4:5", "5:4", "21:9"}
_runninghub_nodes_cache: dict[str, dict[str, str]] = {}


class RunningHubImageRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    image: str | None = None
    ratio: str | None = None


def runninghub_node_settings(client, workflow_id: str) -> dict[str, str]:
    """设置里填了节点编号就用设置的；没填的从工作流结构里自动找。"""
    from config import Config

    configured = {
        "image_node_id": str(Config.RUNNINGHUB_IMAGE_NODE_ID or ""),
        "image_field": str(Config.RUNNINGHUB_IMAGE_FIELD or "image"),
        "prompt_node_id": str(Config.RUNNINGHUB_PROMPT_NODE_ID or ""),
        "prompt_field": str(Config.RUNNINGHUB_PROMPT_FIELD or "text"),
    }
    if workflow_id not in _runninghub_nodes_cache:
        _runninghub_nodes_cache[workflow_id] = client.detect_nodes(client.workflow_json(workflow_id))
    detected = _runninghub_nodes_cache[workflow_id]
    result = dict(detected)
    for key in ("image", "prompt"):
        if configured[f"{key}_node_id"]:
            result[f"{key}_node_id"] = configured[f"{key}_node_id"]
            result[f"{key}_field"] = configured[f"{key}_field"]
    return result


def runninghub_image_job(prompt: str, image_path: str | None, ratio: str | None) -> list[str]:
    from config import Config
    from models.video_runninghub import RunningHubError, RunningHubVideoClient

    workflow_id = str(Config.RUNNINGHUB_WORKFLOW_ID or "").strip()
    if not workflow_id:
        raise RunningHubError("还没有在设置里填写 RunningHub 工作流 ID")
    client = RunningHubVideoClient()
    nodes = runninghub_node_settings(client, workflow_id)
    if nodes.get("image_node_id") and not image_path:
        raise RunningHubError("这个工作流需要一张参考图：先在画布上选中一张图")
    node_info = []
    if image_path and nodes.get("image_node_id"):
        node_info.append({"nodeId": nodes["image_node_id"], "fieldName": nodes.get("image_field") or "image",
                          "fieldValue": client.upload_image(image_path)})
    if nodes.get("prompt_node_id"):
        node_info.append({"nodeId": nodes["prompt_node_id"], "fieldName": nodes.get("prompt_field") or "text",
                          "fieldValue": prompt})
    if ratio in RUNNINGHUB_RATIOS and nodes.get("ratio_node_id"):
        node_info.append({"nodeId": nodes["ratio_node_id"], "fieldName": nodes["ratio_field"], "fieldValue": ratio})

    outputs = client.run_workflow(workflow_id, node_info)
    paths: list[str] = []
    for item in outputs:
        url = str(item.get("fileUrl") or "")
        ext = os.path.splitext(url.split("?")[0])[1].lower()
        if ext not in IMAGE_EXTS:
            continue
        save_path = os.path.join(RUNNINGHUB_RESULT_DIR, f"{uuid.uuid4().hex[:12]}{ext}")
        client.download(url, save_path)
        paths.append(os.path.relpath(save_path, settings.CODE_DIR).replace(os.sep, "/"))
    if not paths:
        raise RunningHubError("RunningHub 任务完成了，但输出里没有图片")
    return paths


@router.post("/api/canvas/runninghub/image")
async def runninghub_image(req: RunningHubImageRequest):
    """直接跑 RunningHub 工作流出图：上传参考图 → 填提示词 → 等结果 → 下载到本地。"""
    from fastapi.concurrency import run_in_threadpool
    from api.routers.sandbox import _add_record, _validated_media_reference
    from models.video_runninghub import RunningHubError

    image_path = _validated_media_reference(req.image) if req.image else None
    if image_path and image_path.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="参考图需要是画布上的本地图片")
    try:
        paths = await run_in_threadpool(runninghub_image_job, req.prompt, image_path, req.ratio)
    except RunningHubError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("RunningHub image job failed", exc_info=True)
        raise HTTPException(status_code=502, detail=f"连接 RunningHub 失败：{exc}") from exc
    absolute = [os.path.join(settings.CODE_DIR, p) for p in paths]
    _add_record("runninghub", "runninghub-workflow", {"prompt": req.prompt, "image": req.image, "ratio": req.ratio},
                {"images": absolute}, files=absolute)
    return {"result": paths}
