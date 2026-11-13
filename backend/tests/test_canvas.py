import os
import tempfile
import unittest
from unittest.mock import patch

from api.routers import canvas


class GalleryExportPathTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.result_dir = os.path.join(self.tmp.name, "result")
        os.makedirs(os.path.join(self.result_dir, "sandbox"))
        self.image = os.path.join(self.result_dir, "sandbox", "a.png")
        with open(self.image, "wb") as f:
            f.write(b"png")
        with open(os.path.join(self.result_dir, "sandbox", "history.json"), "w") as f:
            f.write("[]")
        self.secret = os.path.join(self.tmp.name, "config.yaml")
        with open(self.secret, "w") as f:
            f.write("api_key: x")
        patcher = patch.object(canvas, "RESULT_DIR", self.result_dir)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_accepts_result_paths_in_all_frontend_forms(self):
        for value in ("result/sandbox/a.png", "/code/result/sandbox/a.png", "sandbox/a.png"):
            self.assertEqual(canvas.resolve_export_paths([value]), [os.path.realpath(self.image)])

    def test_rejects_paths_outside_result(self):
        for value in ("../config.yaml", self.secret, "result/../config.yaml"):
            with self.assertRaises(ValueError):
                canvas.resolve_export_paths([value])

    def test_rejects_non_images_and_empty(self):
        with self.assertRaises(ValueError):
            canvas.resolve_export_paths(["result/sandbox/history.json"])
        with self.assertRaises(ValueError):
            canvas.resolve_export_paths([])


class ImageOptionTests(unittest.TestCase):
    def test_resolution_presets_and_custom_sizes(self):
        from fastapi import HTTPException
        from api.routers.sandbox import validate_image_resolution

        self.assertEqual(validate_image_resolution(None), "2K")
        self.assertEqual(validate_image_resolution("1080p"), "1080P")
        self.assertEqual(validate_image_resolution("1200x1600"), "1200*1600")
        for bad in ("4096*4096", "100*100", "abc", "1200*"):
            with self.assertRaises(HTTPException):
                validate_image_resolution(bad)

    def test_output_format_conversion(self):
        from PIL import Image
        from api.routers.sandbox import convert_output_format

        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "a.png")
            Image.new("RGBA", (8, 8), (255, 0, 0, 128)).save(src)
            out = convert_output_format([src], "jpeg")
            self.assertEqual(out, [os.path.join(tmp, "a.jpg")])
            self.assertFalse(os.path.exists(src))
            with Image.open(out[0]) as img:
                self.assertEqual(img.format, "JPEG")
            self.assertEqual(convert_output_format(out, None), out)


class BrandKitTests(unittest.TestCase):
    def test_drops_invalid_colors_and_rejects_outside_anchor(self):
        from fastapi import HTTPException

        kit = canvas.BrandKit(name=" 奶油风 ", style_words="极简", colors=["#FFAA00", "red", "#12345"])
        data = canvas.normalize_brand_kit(kit)
        self.assertEqual(data["name"], "奶油风")
        self.assertEqual(data["colors"], ["#ffaa00"])
        with self.assertRaises(HTTPException):
            canvas.normalize_brand_kit(canvas.BrandKit(name="x", anchor_image="../config.yaml"))


class RunningHubTests(unittest.TestCase):
    def test_node_info_maps_configured_fields(self):
        from models.video_runninghub import RunningHubVideoClient

        nodes = RunningHubVideoClient.build_node_info(
            image_file="api/abc.png", prompt="小猫跳上桌", duration=5,
            image_node_id="10", image_field="image", prompt_node_id="6", prompt_field="text",
            duration_node_id="", duration_field="duration",
        )
        self.assertEqual(nodes, [
            {"nodeId": "10", "fieldName": "image", "fieldValue": "api/abc.png"},
            {"nodeId": "6", "fieldName": "text", "fieldValue": "小猫跳上桌"},
        ])

    def test_missing_key_is_reported_in_chinese(self):
        from models.video_runninghub import RunningHubError, RunningHubVideoClient

        with self.assertRaises(RunningHubError):
            RunningHubVideoClient(api_key="").account_status()


if __name__ == "__main__":
    unittest.main()


def test_runninghub_detect_nodes_finds_image_prompt_and_ratio():
    from models.video_runninghub import RunningHubVideoClient

    workflow = {
        "35": {"class_type": "ImageStitch", "inputs": {"direction": "right"}},
        "3": {"class_type": "LoadImage", "inputs": {"image": "a.png"}},
        "4": {"class_type": "RH_Image", "inputs": {"prompt": "猫", "aspectRatio": "3:4", "image": ["3", 0]}},
        "36": {"class_type": "SaveImage", "inputs": {"filename_prefix": "ComfyUI"}},
    }
    nodes = RunningHubVideoClient.detect_nodes(workflow)
    assert nodes["image_node_id"] == "3" and nodes["image_field"] == "image"
    assert nodes["prompt_node_id"] == "4" and nodes["prompt_field"] == "prompt"
    assert nodes["ratio_node_id"] == "4" and nodes["ratio_field"] == "aspectRatio"
