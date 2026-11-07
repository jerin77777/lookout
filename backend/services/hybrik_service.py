import os
import sys
import time
import base64
import logging
import numpy as np
import cv2
import torch
from typing import Optional, Dict, Any, List
from torchvision import transforms as T

logger = logging.getLogger("HybrIK-Service")

# Setup HybrIK Directory paths inside backend
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HYBRIK_DIR = os.path.join(BACKEND_DIR, "ai", "hybrik")

if os.path.exists(HYBRIK_DIR) and HYBRIK_DIR not in sys.path:
    sys.path.insert(0, HYBRIK_DIR)

class HybrIKService:
    def __init__(self):
        self.device = None
        self.model = None
        self.cfg = None
        self.det_model = None
        self.transform = None
        self.det_transform = T.Compose([T.ToTensor()])
        self.joint_names = []
        self.is_loaded = False
        self._loading_error = None

    def load_models(self):
        if self.is_loaded:
            return True

        if not os.path.exists(HYBRIK_DIR):
            logger.error(f"HybrIK directory not found at {HYBRIK_DIR}")
            self._loading_error = f"Directory not found: {HYBRIK_DIR}"
            return False

        current_cwd = os.getcwd()
        try:
            os.chdir(HYBRIK_DIR)
            from hybrikx_inference import (
                load_hybrikx_model,
                load_detector,
                build_transform,
                SMPLX_JOINT_NAMES,
            )

            self.joint_names = SMPLX_JOINT_NAMES

            if torch.cuda.is_available():
                self.device = torch.device("cuda:0")
                logger.info(f"HybrIK using CUDA GPU: {torch.cuda.get_device_name(0)}")
            else:
                self.device = torch.device("cpu")
                logger.warning("HybrIK: CUDA not available. Running on CPU.")

            cfg_path = os.path.join(HYBRIK_DIR, "configs", "smplx", "256x192_hrnet_rle_smplx_kid.yaml")
            ckpt_path = os.path.join(HYBRIK_DIR, "pretrained_models", "hybrikx_rle_hrnet.pth")

            logger.info("Loading HybrIK-X model weights...")
            self.model, self.cfg = load_hybrikx_model(cfg_path, ckpt_path, self.device)
            self.det_model = load_detector(self.device)
            self.transform = build_transform(self.cfg)
            self.is_loaded = True
            logger.info("HybrIK-X models loaded successfully into PyBackend!")
            return True
        except Exception as e:
            logger.error(f"Failed to load HybrIK models: {e}", exc_info=True)
            self._loading_error = str(e)
            return False
        finally:
            os.chdir(current_cwd)

    def get_status(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "model_loaded": self.is_loaded,
            "device": str(self.device) if self.device else "none",
            "joint_count": len(self.joint_names) if self.joint_names else 0,
            "error": self._loading_error,
        }

    def infer_bgr_frame(self, frame_bgr: np.ndarray) -> Dict[str, Any]:
        if not self.is_loaded:
            success = self.load_models()
            if not success or not self.model:
                return {
                    "success": False,
                    "message": f"Models not loaded: {self._loading_error or 'Unknown error'}",
                }

        t0 = time.time()
        current_cwd = os.getcwd()
        try:
            os.chdir(HYBRIK_DIR)
            from hybrikx_inference import preprocess_frame, run_single_frame

            frame_rgb, bbox_xyxy = preprocess_frame(
                frame_bgr, self.det_model, self.det_transform, self.device
            )

            if bbox_xyxy is None:
                return {
                    "success": False,
                    "message": "No person detected in frame",
                    "process_time_ms": round((time.time() - t0) * 1000, 2),
                }

            result, _ = run_single_frame(
                frame_rgb, bbox_xyxy, self.model, self.transform, self.cfg, self.device
            )

            joints_3d = result.get("joints_3d")
            joints_2d = result.get("joints_2d")
            body_pose = result.get("body_pose")
            betas = result.get("betas")
            camera = result.get("camera")

            j3d_list = (joints_3d[0] if joints_3d.ndim == 3 else joints_3d).tolist() if joints_3d is not None else []
            j2d_list = (joints_2d[0] if joints_2d.ndim == 3 else joints_2d).tolist() if joints_2d is not None else []
            body_pose_list = body_pose[0].tolist() if body_pose is not None else []
            betas_list = betas[0].tolist() if betas is not None else []
            camera_list = camera[0].tolist() if camera is not None else []

            process_time = round((time.time() - t0) * 1000, 2)

            return {
                "success": True,
                "process_time_ms": process_time,
                "bbox": bbox_xyxy.tolist() if isinstance(bbox_xyxy, np.ndarray) else bbox_xyxy,
                "joint_names": self.joint_names,
                "joints_3d": j3d_list,
                "joints_2d": j2d_list,
                "body_pose": body_pose_list,
                "betas": betas_list,
                "camera": camera_list,
            }
        except Exception as e:
            logger.error(f"HybrIK frame inference error: {e}", exc_info=True)
            return {"success": False, "message": str(e)}
        finally:
            os.chdir(current_cwd)

    def infer_base64_image(self, img_str: str) -> Dict[str, Any]:
        try:
            if "," in img_str:
                img_str = img_str.split(",")[1]
            img_bytes = base64.b64decode(img_str)
            nparr = np.frombuffer(img_bytes, np.uint8)
            frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame_bgr is None:
                return {"success": False, "message": "Invalid base64 image data"}
            return self.infer_bgr_frame(frame_bgr)
        except Exception as e:
            return {"success": False, "message": str(e)}

    def infer_image_bytes(self, contents: bytes) -> Dict[str, Any]:
        try:
            nparr = np.frombuffer(contents, np.uint8)
            frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame_bgr is None:
                return {"success": False, "message": "Invalid image file"}
            return self.infer_bgr_frame(frame_bgr)
        except Exception as e:
            return {"success": False, "message": str(e)}

hybrik_service = HybrIKService()
