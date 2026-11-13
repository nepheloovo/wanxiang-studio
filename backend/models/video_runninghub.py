"""RunningHub 视频生成：调用你在 RunningHub 上的「图生视频」工作流（ComfyUI 工作流或 AI 应用）。

RunningHub 的 OpenAPI 按工作流运行，不同工作流的节点编号不同，所以需要在设置里填写：
- workflow_id：工作流 ID
- image_node_id / image_field：放首帧图片的节点和字段（通常是 LoadImage 节点的 image）
- prompt_node_id / prompt_field：放提示词的节点和字段（通常是文本节点的 text）
- duration_node_id / duration_field：可选，放时长的节点和字段

流程：上传图片 → 创建任务 → 轮询状态 → 读取输出 → 下载视频。
"""

import logging
import os
import time
from typing import Any, Optional

import requests

from config import Config

logger = logging.getLogger(__name__)

POLL_INTERVAL = 5
POLL_TIMEOUT = 20 * 60


class RunningHubError(RuntimeError):
    pass


ERROR_HINTS = {
    "NOT_ENOUGH_BALANCE": "RunningHub 余额不足：API 调用按 RH 币扣费（积分不能用），请到 RunningHub 充值后重试",
    "APIKEY_INVALID": "RunningHub API Key 无效，请到设置里重新填写",
    "TOKEN_INVALID": "RunningHub API Key 无效，请到设置里重新填写",
    "WORKFLOW_NOT_EXISTS": "找不到这个 RunningHub 工作流，请检查设置里的工作流 ID",
    "TASK_QUEUE_MAXED": "RunningHub 当前排队任务已满，请稍后再试",
}


def _error_text(data: dict) -> str:
    msg = str(data.get("msg") or data.get("code") or "")
    return ERROR_HINTS.get(msg) or f"RunningHub 返回错误：{msg}"


class RunningHubVideoClient:
    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self.api_key = (api_key if api_key is not None else Config.RUNNINGHUB_API_KEY) or ""
        self.base_url = (base_url or Config.RUNNINGHUB_BASE_URL or "https://www.runninghub.cn").rstrip("/")
        self.session = requests.Session()
        proxy = Config.PROXY if getattr(Config, "RUNNINGHUB_ENABLE_PROXY", False) else ""
        if proxy:
            self.session.proxies.update({"http": proxy, "https": proxy})

    # ── 基础请求 ──
    def _post(self, path: str, payload: dict[str, Any]) -> Any:
        if not self.api_key:
            raise RunningHubError("还没有填写 RunningHub API Key")
        resp = self.session.post(
            f"{self.base_url}{path}",
            json={"apiKey": self.api_key, **payload},
            headers={"Content-Type": "application/json"},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") not in (0, "0"):
            raise RunningHubError(_error_text(data))
        return data.get("data")

    def account_status(self) -> dict[str, Any]:
        """查询账号余额等信息，用于设置页「核查账号」。"""
        if not self.api_key:
            raise RunningHubError("还没有填写 RunningHub API Key")
        resp = self.session.post(
            f"{self.base_url}/uc/openapi/accountStatus",
            json={"apikey": self.api_key, "apiKey": self.api_key},
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") not in (0, "0"):
            raise RunningHubError(_error_text(data))
        return data.get("data") or {}

    def upload_image(self, image_path: str) -> str:
        if not self.api_key:
            raise RunningHubError("还没有填写 RunningHub API Key")
        with open(image_path, "rb") as f:
            resp = self.session.post(
                f"{self.base_url}/task/openapi/upload",
                data={"apiKey": self.api_key, "fileType": "image"},
                files={"file": (os.path.basename(image_path), f)},
                timeout=120,
            )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") not in (0, "0"):
            raise RunningHubError(f"图片上传失败：{data.get('msg') or data.get('code')}")
        file_name = (data.get("data") or {}).get("fileName")
        if not file_name:
            raise RunningHubError("图片上传失败：没有返回文件名")
        return file_name

    # ── 工作流 ──
    def workflow_json(self, workflow_id: str) -> dict[str, Any]:
        """读取工作流结构（各节点的类型和输入），用来自动找到图片、提示词节点。"""
        data = self._post("/api/openapi/getJsonApiFormat", {"workflowId": str(workflow_id)})
        prompt = (data or {}).get("prompt")
        if isinstance(prompt, str):
            import json
            prompt = json.loads(prompt)
        return prompt if isinstance(prompt, dict) else {}

    @staticmethod
    def detect_nodes(workflow: dict[str, Any]) -> dict[str, str]:
        """从工作流结构里找：放图片的 LoadImage 节点、放提示词的节点、比例字段。"""
        found: dict[str, str] = {}
        for node_id, node in sorted(workflow.items(), key=lambda item: int(item[0]) if str(item[0]).isdigit() else 0):
            cls = str(node.get("class_type", ""))
            inputs = node.get("inputs") or {}
            if "image_node_id" not in found and cls == "LoadImage":
                found["image_node_id"], found["image_field"] = str(node_id), "image"
                continue
            if "prompt_node_id" not in found:
                for field in ("prompt", "text", "positive"):
                    if isinstance(inputs.get(field), str):
                        found["prompt_node_id"], found["prompt_field"] = str(node_id), field
                        break
            if "ratio_node_id" not in found:
                for field in ("aspectRatio", "aspect_ratio", "ratio"):
                    if isinstance(inputs.get(field), str):
                        found["ratio_node_id"], found["ratio_field"] = str(node_id), field
                        break
        return found

    def run_workflow(self, workflow_id: str, node_info: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """创建任务并等到完成，返回输出文件列表（fileUrl / fileType）。"""
        created = self._post("/task/openapi/create", {"workflowId": str(workflow_id), "nodeInfoList": node_info})
        task_id = (created or {}).get("taskId")
        if not task_id:
            raise RunningHubError("RunningHub 没有返回任务 ID")
        logger.info("RunningHub task created: %s", task_id)
        return self._wait_for_outputs(str(task_id))

    def download(self, url: str, save_path: str) -> str:
        os.makedirs(os.path.dirname(save_path) or ".", exist_ok=True)
        with self.session.get(url, stream=True, timeout=300) as resp:
            resp.raise_for_status()
            with open(save_path, "wb") as f:
                for chunk in resp.iter_content(1024 * 1024):
                    f.write(chunk)
        return save_path

    @staticmethod
    def build_node_info(
        *,
        image_file: Optional[str],
        prompt: str,
        duration: Optional[int],
        image_node_id: str,
        image_field: str,
        prompt_node_id: str,
        prompt_field: str,
        duration_node_id: str = "",
        duration_field: str = "",
    ) -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        if image_file and image_node_id:
            nodes.append({"nodeId": str(image_node_id), "fieldName": image_field or "image", "fieldValue": image_file})
        if prompt_node_id:
            nodes.append({"nodeId": str(prompt_node_id), "fieldName": prompt_field or "text", "fieldValue": prompt})
        if duration and duration_node_id:
            nodes.append({"nodeId": str(duration_node_id), "fieldName": duration_field or "duration", "fieldValue": int(duration)})
        return nodes

    def _wait_for_outputs(self, task_id: str) -> list[dict[str, Any]]:
        deadline = time.time() + POLL_TIMEOUT
        while time.time() < deadline:
            status = self._post("/task/openapi/status", {"taskId": task_id})
            if isinstance(status, dict):
                status = status.get("taskStatus") or status.get("status")
            status_text = str(status or "").upper()
            if status_text == "SUCCESS":
                outputs = self._post("/task/openapi/outputs", {"taskId": task_id})
                return outputs if isinstance(outputs, list) else []
            if status_text == "FAILED":
                raise RunningHubError("RunningHub 任务失败，请到 RunningHub 查看任务详情")
            time.sleep(POLL_INTERVAL)
        raise RunningHubError("RunningHub 任务超时（20 分钟）")

    def generate_video(self, prompt: str, image_path: Optional[str], save_path: str, duration: int = 5) -> str:
        workflow_id = str(Config.RUNNINGHUB_WORKFLOW_ID or "").strip()
        if not workflow_id:
            raise RunningHubError("还没有填写 RunningHub 工作流 ID")
        image_file = self.upload_image(image_path) if image_path else None
        node_info = self.build_node_info(
            image_file=image_file,
            prompt=prompt,
            duration=duration,
            image_node_id=str(Config.RUNNINGHUB_IMAGE_NODE_ID or ""),
            image_field=str(Config.RUNNINGHUB_IMAGE_FIELD or "image"),
            prompt_node_id=str(Config.RUNNINGHUB_PROMPT_NODE_ID or ""),
            prompt_field=str(Config.RUNNINGHUB_PROMPT_FIELD or "text"),
            duration_node_id=str(Config.RUNNINGHUB_DURATION_NODE_ID or ""),
            duration_field=str(Config.RUNNINGHUB_DURATION_FIELD or "duration"),
        )
        created = self._post("/task/openapi/create", {"workflowId": workflow_id, "nodeInfoList": node_info})
        task_id = (created or {}).get("taskId")
        if not task_id:
            raise RunningHubError("RunningHub 没有返回任务 ID")
        logger.info("RunningHub task created: %s", task_id)
        outputs = self._wait_for_outputs(str(task_id))
        video = next(
            (item for item in outputs if str(item.get("fileType", "")).lower() in {"mp4", "mov", "webm", "video"}
             or str(item.get("fileUrl", "")).lower().split("?")[0].endswith((".mp4", ".mov", ".webm"))),
            None,
        )
        if not video:
            raise RunningHubError("RunningHub 任务完成，但输出里没有视频")
        url = video["fileUrl"]
        os.makedirs(os.path.dirname(save_path) or ".", exist_ok=True)
        with self.session.get(url, stream=True, timeout=300) as resp:
            resp.raise_for_status()
            with open(save_path, "wb") as f:
                for chunk in resp.iter_content(1024 * 1024):
                    f.write(chunk)
        return url
