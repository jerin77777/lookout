"""
HybrIK-X Inference Script
==========================
Whole-body 3D Human Pose and Shape Estimation using SMPL-X.
Based on: "HybrIK-X: Hybrid Analytical-Neural Inverse Kinematics for Whole-body Mesh Recovery" (TPAMI 2025)
Repository: https://github.com/Jeff-sjtu/HybrIK

Supports:
  - Single image inference
  - Video inference (frame-by-frame)
  - Batch image inference
  - Saving output pickle, rendered images, and video

Usage:
    # Video inference
    python hybrikx_inference.py --mode video --input examples/dance.mp4 --out-dir results/

    # Image inference
    python hybrikx_inference.py --mode image --input examples/sample.jpg --out-dir results/

    # Batch images in folder
    python hybrikx_inference.py --mode batch --input examples/images/ --out-dir results/

Requirements:
    pip install torch torchvision opencv-python easydict tqdm
    pip install git+https://github.com/Jeff-sjtu/HybrIK.git
    # Optional for 3D mesh rendering:
    pip install pytorch3d  # (see https://github.com/facebookresearch/pytorch3d)

Pretrained model & config:
    Download from: https://github.com/Jeff-sjtu/HybrIK#model-zoo
    Config  : configs/smplx/256x192_hrnet_rle_smplx_kid.yaml
    Weights : pretrained_models/hybrikx_rle_hrnet.pth
"""

import argparse
import os
import sys
import time
import pickle
import logging
from pathlib import Path

import cv2
import numpy as np
import torch
from easydict import EasyDict as edict
from tqdm import tqdm

# ── HybrIK imports ─────────────────────────────────────────────────────────────
try:
    from hybrik.models import builder
    from hybrik.utils.config import update_config
    from hybrik.utils.presets import SimpleTransform3DSMPLX
    from hybrik.utils.vis import get_max_iou_box, get_one_box, vis_2d
except ImportError as e:
    sys.exit(
        f"[ERROR] HybrIK package not found: {e}\n"
        "Install with:  pip install git+https://github.com/Jeff-sjtu/HybrIK.git"
    )

# ── Torchvision imports ────────────────────────────────────────────────────────
from torchvision import transforms as T
from torchvision.models.detection import fasterrcnn_resnet50_fpn

# ── Optional pytorch3d for 3-D mesh rendering ─────────────────────────────────
try:
    from hybrik.utils.render_pytorch3d import render_mesh
    PYTORCH3D_AVAILABLE = True
except ImportError:
    PYTORCH3D_AVAILABLE = False

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s - %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("HybrIK-X")

# ── Constants ──────────────────────────────────────────────────────────────────
DEFAULT_CFG  = "./configs/smplx/256x192_hrnet_rle_smplx_kid.yaml"
DEFAULT_CKPT = "./pretrained_models/hybrikx_rle_hrnet.pth"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}

# Halpe whole-body hand joint indices
HALPE_LHAND_IDS  = [5, 6, 7, 9, 10, 11, 17, 18, 19, 13, 14, 15, 1, 2, 3]
HALPE_RHAND_IDS  = [5, 6, 7, 9, 10, 11, 17, 18, 19, 13, 14, 15, 1, 2, 3]
HALPE_LHAND_LEAF = [8, 12, 20, 16, 4]
HALPE_RHAND_LEAF = [8, 12, 20, 16, 4]
HALPE_WRIST_IDS  = [94, 115]

HALPE_HAND_IDS       = ([i + 94  for i in HALPE_LHAND_IDS]  +
                         [i + 115 for i in HALPE_RHAND_IDS])
HALPE_HAND_LEAF_IDS  = ([i + 94  for i in HALPE_LHAND_LEAF] +
                         [i + 115 for i in HALPE_RHAND_LEAF])

# SMPL-X 29-joint names used by HybrIK-X (pred_xyz_jts_29)
# Indices 0-28 correspond to the body skeleton predicted by the model.
SMPLX_JOINT_NAMES = [
    "Pelvis",          # 0
    "L_Hip",           # 1
    "R_Hip",           # 2
    "Spine1",          # 3
    "L_Knee",          # 4
    "R_Knee",          # 5
    "Spine2",          # 6
    "L_Ankle",         # 7
    "R_Ankle",         # 8
    "Spine3",          # 9
    "L_Foot",          # 10
    "R_Foot",          # 11
    "Neck",            # 12
    "L_Collar",        # 13
    "R_Collar",        # 14
    "Head",            # 15
    "L_Shoulder",      # 16
    "R_Shoulder",      # 17
    "L_Elbow",         # 18
    "R_Elbow",         # 19
    "L_Wrist",         # 20
    "R_Wrist",         # 21
    "L_Hand",          # 22
    "R_Hand",          # 23
    "Nose",            # 24
    "L_Eye",           # 25
    "R_Eye",           # 26
    "L_Ear",           # 27
    "R_Ear",           # 28
]


# ── Utility functions ──────────────────────────────────────────────────────────

def xyxy2xywh(bbox):
    """Convert [x1,y1,x2,y2] bounding box to [cx,cy,w,h]."""
    x1, y1, x2, y2 = bbox
    return [(x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1]


def get_video_info(video_path: str):
    """Return (metadata_dict, frame_count) for a video file."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise IOError(f"Cannot open video: {video_path}")

    n_frames  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps       = cap.get(cv2.CAP_PROP_FPS)
    width     = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height    = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fourcc    = int(cap.get(cv2.CAP_PROP_FOURCC))

    info = {"fps": fps, "frame_size": (width, height), "fourcc": fourcc}
    cap.release()
    return info, n_frames


def fourcc_for_ext(ext: str):
    """Return (OpenCV VideoWriter fourcc code, normalised extension string)."""
    ext = ext.lstrip(".").lower()
    mapping = {
        "mp4": (cv2.VideoWriter_fourcc(*"mp4v"), ".mp4"),
        "avi": (cv2.VideoWriter_fourcc(*"XVID"), ".avi"),
        "mov": (cv2.VideoWriter_fourcc(*"XVID"), ".mov"),
    }
    return mapping.get(ext, (cv2.VideoWriter_fourcc(*"mp4v"), ".mp4"))


def preprocess_frame(frame_bgr, det_model, det_transform, device):
    """
    Run person detection and return (frame_rgb, bbox_xyxy).
    Returns (None, None) if no person is found.
    """
    frame_rgb  = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    det_input  = det_transform(frame_rgb).to(device)

    with torch.no_grad():
        detections = det_model([det_input])[0]

    # Filter to 'person' class (COCO id = 1) with confidence > 0.5
    keep   = (detections["labels"] == 1) & (detections["scores"] > 0.5)
    boxes  = detections["boxes"][keep].cpu().numpy()
    scores = detections["scores"][keep].cpu().numpy()

    if len(boxes) == 0:
        return None, None

    # Pick the largest-area person box (matching get_one_box behaviour)
    areas     = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    best_idx  = int(areas.argmax())
    bbox_xyxy = [float(x) for x in boxes[best_idx]]
    return frame_rgb, bbox_xyxy


# ── Model loading ──────────────────────────────────────────────────────────────

def load_hybrikx_model(cfg_path: str, ckpt_path: str, device: torch.device):
    """Build HybrIK-X model, load weights, and set to eval mode."""
    logger.info(f"Loading config  : {cfg_path}")
    logger.info(f"Loading weights : {ckpt_path}")

    if not os.path.isfile(cfg_path):
        raise FileNotFoundError(f"Config not found: {cfg_path}")
    if not os.path.isfile(ckpt_path):
        raise FileNotFoundError(f"Checkpoint not found: {ckpt_path}")

    cfg = update_config(cfg_path)

    # KID (kid-in-the-mix augmentation) flag
    use_kid = cfg["DATASET"].get("USE_KID", False)
    cfg["MODEL"]["EXTRA"]["USE_KID"] = use_kid
    cfg["LOSS"]["ELEMENTS"]["USE_KID"] = use_kid

    model = builder.build_sppe(cfg.MODEL)

    logger.info("Loading checkpoint ...")
    state = torch.load(ckpt_path, map_location="cpu")
    # Handle 'state_dict' / 'model' wrapper
    state = state.get("model", state.get("state_dict", state))
    model.load_state_dict(state, strict=False)

    model.to(device)
    model.eval()
    logger.info("Model ready.")
    return model, cfg


def load_detector(device: torch.device):
    """Load a pretrained Faster-RCNN person detector from torchvision."""
    logger.info("Loading person detector (Faster-RCNN) ...")
    det_model = fasterrcnn_resnet50_fpn(pretrained=True)
    det_model.to(device)
    det_model.eval()
    return det_model


# ── Preprocessing ──────────────────────────────────────────────────────────────

def build_transform(cfg):
    """Build the SimpleTransform3DSMPLX preprocessing pipeline from config."""
    bbox_3d_shape = getattr(cfg.MODEL, "BBOX_3D_SHAPE", (2000, 2000, 2000))
    bbox_3d_shape = [item * 1e-3 for item in bbox_3d_shape]

    dummy_set = edict({
        'joint_pairs_17': None,
        'joint_pairs_24': None,
        'joint_pairs_29': None,
        'bbox_3d_shape': bbox_3d_shape
    })

    transform = SimpleTransform3DSMPLX(
        dummy_set,
        scale_factor=cfg.DATASET.SCALE_FACTOR,
        color_factor=cfg.DATASET.COLOR_FACTOR,
        occlusion=cfg.DATASET.OCCLUSION,
        input_size=cfg.MODEL.IMAGE_SIZE,
        output_size=cfg.MODEL.HEATMAP_SIZE,
        depth_dim=cfg.MODEL.EXTRA.DEPTH_DIM,
        bbox_3d_shape=bbox_3d_shape,
        rot=cfg.DATASET.ROT_FACTOR,
        sigma=cfg.MODEL.EXTRA.SIGMA,
        train=False,
        add_dpg=False,
        loss_type=cfg.LOSS["TYPE"],
    )
    return transform


# ── Single-frame inference ────────────────────────────────────────────────────

@torch.no_grad()
def run_single_frame(
    frame_rgb: np.ndarray,
    bbox_xyxy,
    model,
    transform,
    cfg,
    device: torch.device,
):
    """
    Run HybrIK-X on one RGB frame given the detected bounding box.

    Returns:
        result  – dict of numpy arrays (SMPL-X params, joints, vertices …)
        output  – raw model output object (for rendering)
    """
    img_h, img_w = frame_rgb.shape[:2]
    bbox_xywh    = xyxy2xywh(bbox_xyxy)

    # Preprocessing via HybrIK's transform — returns (tensor, bbox_xyxy, img_center)
    pose_input, bbox, img_center = transform.test_transform(frame_rgb.copy(), bbox_xyxy)
    pose_input = pose_input.to(device).unsqueeze(0)   # [1, C, H, W]

    # Forward pass (matching official demo_video_x.py)
    output = model(
        pose_input,
        flip_test=True,
        bboxes=torch.from_numpy(np.array(bbox)).to(device).unsqueeze(0).float(),
        img_center=torch.from_numpy(img_center).to(device).unsqueeze(0).float(),
    )

    # Pack results as plain numpy arrays for easy serialisation
    def _reshape_joints(val, n_joints=71):
        """Reshape flat [1, J*3] tensor to [1, J, 3]."""
        if val is None:
            return None
        return val.reshape(1, n_joints, 3)

    result = {
        "bbox":          bbox_xyxy,
        # SMPL-X shape β  [1, 11]
        "betas":         _to_np(output, "pred_beta"),
        # Face expression [1, 10]
        "expression":    _to_np(output, "pred_expression"),
        # Body pose (rotation matrices flattened) [1, 495]
        "body_pose":     _to_np(output, "pred_theta_mat"),
        # Predicted camera (scale) [1, 1]
        "camera":        _to_np(output, "pred_camera"),
        # 3D joints from HybrIK (xyz) [1, 71, 3]
        "joints_3d":     _reshape_joints(_to_np(output, "pred_xyz_hybrik")),
        # UVD joints [1, 71, 3]
        "joints_2d":     _reshape_joints(_to_np(output, "pred_uvd_jts")),
        # Mesh vertices [1, 10475, 3]
        "vertices":      _to_np(output, "pred_vertices"),
        # Left/right hand UVD [1, 15, 3]
        "lhand_uvd":     _to_np(output, "pred_lh_uvd"),
        "rhand_uvd":     _to_np(output, "pred_rh_uvd"),
    }
    return result, output


def _to_np(obj, attr: str):
    """Safely extract a tensor attribute to numpy; return None if absent."""
    val = getattr(obj, attr, None)
    return val.cpu().numpy() if val is not None else None


# ── World-landmark printer ────────────────────────────────────────────────────

def print_world_landmarks(result: dict, label: str = ""):
    """
    Print the 3D world-space landmarks predicted by HybrIK-X.

    result["joints_3d"] has shape [1, J, 3] where each joint stores
    (X, Y, Z) coordinates in camera / world space (metres, root-relative).
    """
    joints_3d = result.get("joints_3d")
    if joints_3d is None:
        print("  [!] No 3D joint data available.")
        return

    # Shape: [1, J, 3]  → squeeze batch dim → [J, 3]
    jts = joints_3d[0] if joints_3d.ndim == 3 else joints_3d
    n_joints = jts.shape[0]

    header = f" World Landmarks {'— ' + label + ' ' if label else ''}({n_joints} joints) "
    sep    = "=" * max(60, len(header) + 4)

    print(f"\n{sep}")
    print(f"  {header}")
    print(sep)
    print(f"  {'#':<4}  {'Joint Name':<18}  {'X (m)':>10}  {'Y (m)':>10}  {'Z (m)':>10}")
    print(f"  {'-'*4}  {'-'*18}  {'-'*10}  {'-'*10}  {'-'*10}")

    for i in range(n_joints):
        name = SMPLX_JOINT_NAMES[i] if i < len(SMPLX_JOINT_NAMES) else f"Joint_{i}"
        x, y, z = float(jts[i, 0]), float(jts[i, 1]), float(jts[i, 2])
        print(f"  {i:<4}  {name:<18}  {x:>10.4f}  {y:>10.4f}  {z:>10.4f}")

    print(sep + "\n")


# ── Rendering / visualisation ─────────────────────────────────────────────────

def render_on_frame(frame_bgr: np.ndarray, output, cfg, device):
    """
    Overlay the 3D mesh on the original BGR frame.
    Uses pytorch3d if available; falls back to 2D skeleton drawing.
    """
    if PYTORCH3D_AVAILABLE:
        try:
            img_h, img_w = frame_bgr.shape[:2]
            focal = (img_w ** 2 + img_h ** 2) ** 0.5
            rendered = render_mesh(
                frame_bgr,
                output.pred_vertices[0].cpu().numpy(),
                output.faces,
                output.pred_camera[0].cpu().numpy(),
                focal_length=focal,
            )
            return rendered
        except Exception as exc:
            logger.debug(f"3D render failed ({exc}); using 2D fallback.")

    return _draw_skeleton_2d(frame_bgr, output)


def _draw_skeleton_2d(frame_bgr: np.ndarray, output) -> np.ndarray:
    """Draw normalised UVD joint projections on the frame (simple fallback)."""
    img_h, img_w = frame_bgr.shape[:2]
    uvd = getattr(output, "pred_uvd_jts", None)
    if uvd is None:
        return frame_bgr

    uvd = uvd[0].cpu().numpy()  # [J, 3]
    xs  = ((uvd[:, 0] + 0.5) * img_w).astype(int)
    ys  = ((uvd[:, 1] + 0.5) * img_h).astype(int)

    for x, y in zip(xs, ys):
        if 0 <= x < img_w and 0 <= y < img_h:
            cv2.circle(frame_bgr, (x, y), 5, (0, 255, 100), -1)
    return frame_bgr


# ── Public inference API ───────────────────────────────────────────────────────

def infer_image(
    img_path: str,
    model,
    det_model,
    transform,
    cfg,
    device: torch.device,
    out_dir: str,
    save_img: bool = True,
    save_pk: bool  = True,
):
    """Run HybrIK-X on a single image and optionally save results."""
    frame_bgr = cv2.imread(img_path)
    if frame_bgr is None:
        raise IOError(f"Cannot read image: {img_path}")

    det_transform          = T.Compose([T.ToTensor()])
    frame_rgb, bbox_xyxy   = preprocess_frame(frame_bgr, det_model, det_transform, device)

    if bbox_xyxy is None:
        logger.warning(f"No person detected in: {img_path}")
        return None

    result, output = run_single_frame(frame_rgb, bbox_xyxy, model, transform, cfg, device)

    # ── Print world landmarks ─────────────────────────────────────────────────
    print_world_landmarks(result, label=Path(img_path).name)

    stem = Path(img_path).stem
    os.makedirs(out_dir, exist_ok=True)

    if save_pk:
        pk_path = os.path.join(out_dir, f"{stem}_result.pkl")
        with open(pk_path, "wb") as f:
            pickle.dump(result, f)
        logger.info(f"Saved pickle : {pk_path}")

    if save_img:
        vis_frame    = render_on_frame(frame_bgr.copy(), output, cfg, device)
        out_img_path = os.path.join(out_dir, f"{stem}_vis.jpg")
        cv2.imwrite(out_img_path, vis_frame)
        logger.info(f"Saved image  : {out_img_path}")

    return result


def infer_video(
    video_path: str,
    model,
    det_model,
    transform,
    cfg,
    device: torch.device,
    out_dir: str,
    save_img: bool   = False,
    save_pk: bool    = True,
    save_video: bool = True,
):
    """Run frame-by-frame HybrIK-X inference on a video file."""
    info, n_frames = get_video_info(video_path)
    fps            = info["fps"]
    frame_size     = info["frame_size"]  # (width, height)

    logger.info(
        f"Video : {video_path}  |  frames={n_frames}  fps={fps:.1f}  "
        f"size={frame_size[0]}x{frame_size[1]}"
    )

    os.makedirs(out_dir, exist_ok=True)
    stem          = Path(video_path).stem
    det_transform = T.Compose([T.ToTensor()])

    # Set up video writer
    writer = None
    if save_video:
        ext              = Path(video_path).suffix
        fourcc, out_ext  = fourcc_for_ext(ext)
        out_video_path   = os.path.join(out_dir, f"{stem}_vis{out_ext}")
        writer           = cv2.VideoWriter(out_video_path, fourcc, fps, frame_size)
        logger.info(f"Writing video : {out_video_path}")

    cap          = cv2.VideoCapture(video_path)
    all_results  = []
    prev_box     = None
    frame_idx    = 0

    with tqdm(total=n_frames, desc="Inference", unit="frame") as pbar:
        while True:
            ret, frame_bgr = cap.read()
            if not ret:
                break

            frame_rgb, bbox_xyxy = preprocess_frame(
                frame_bgr, det_model, det_transform, device
            )

            vis_frame = frame_bgr.copy()

            if bbox_xyxy is not None:
                # Temporal IoU smoothing: prefer box most similar to previous
                if prev_box is not None:
                    bbox_xyxy = get_max_iou_box(
                        np.array([bbox_xyxy]), np.array(prev_box)
                    )
                prev_box = bbox_xyxy

                try:
                    result, output = run_single_frame(
                        frame_rgb, bbox_xyxy, model, transform, cfg, device
                    )
                    result["frame_idx"] = frame_idx
                    all_results.append(result)

                    # ── Print world landmarks for this frame ──────────────────
                    print_world_landmarks(result, label=f"Frame {frame_idx}")

                    vis_frame = render_on_frame(vis_frame, output, cfg, device)

                    if save_img:
                        img_out = os.path.join(out_dir, f"frame_{frame_idx:06d}.jpg")
                        cv2.imwrite(img_out, vis_frame)

                except Exception as exc:
                    logger.warning(f"Frame {frame_idx} failed: {exc}")
            else:
                logger.debug(f"Frame {frame_idx}: no person detected.")

            if writer is not None:
                writer.write(vis_frame)

            frame_idx += 1
            pbar.update(1)

    cap.release()
    if writer is not None:
        writer.release()

    if save_pk and all_results:
        pk_path = os.path.join(out_dir, f"{stem}_results.pkl")
        with open(pk_path, "wb") as f:
            pickle.dump(all_results, f)
        logger.info(f"Saved pickle  : {pk_path}  ({len(all_results)} frames)")

    logger.info("Video inference complete.")
    return all_results


def infer_batch(
    img_dir: str,
    model,
    det_model,
    transform,
    cfg,
    device: torch.device,
    out_dir: str,
    save_img: bool = True,
    save_pk: bool  = True,
):
    """Run HybrIK-X inference on all images inside a directory."""
    img_paths = sorted(
        p for p in Path(img_dir).iterdir()
        if p.suffix.lower() in IMAGE_EXTENSIONS
    )

    if not img_paths:
        raise ValueError(f"No supported images found in: {img_dir}")

    logger.info(f"Found {len(img_paths)} images in {img_dir}")
    all_results = {}

    for img_path in tqdm(img_paths, desc="Batch"):
        try:
            result = infer_image(
                str(img_path), model, det_model, transform, cfg,
                device, out_dir, save_img=save_img, save_pk=False,
            )
            all_results[img_path.name] = result
        except Exception as exc:
            logger.warning(f"Skipping {img_path.name}: {exc}")

    if save_pk:
        pk_path = os.path.join(out_dir, "batch_results.pkl")
        with open(pk_path, "wb") as f:
            pickle.dump(all_results, f)
        logger.info(f"Saved batch pickle : {pk_path}")

    logger.info(f"Done. Processed {len(all_results)}/{len(img_paths)} images.")
    return all_results


# ── CLI ───────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="HybrIK-X Whole-body 3D Pose & Shape Inference",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument(
        "--mode", choices=["image", "video", "batch"], default="video",
        help="Inference mode.",
    )
    p.add_argument(
        "--input", required=True,
        help="Path to input image / video / image directory.",
    )
    p.add_argument(
        "--out-dir", default="./hybrikx_results",
        help="Output directory.",
    )
    p.add_argument(
        "--cfg", default=DEFAULT_CFG,
        help="HybrIK-X YAML config path.",
    )
    p.add_argument(
        "--ckpt", default=DEFAULT_CKPT,
        help="HybrIK-X pretrained checkpoint (.pth).",
    )
    p.add_argument(
        "--gpu", type=int, default=0,
        help="GPU id to use (-1 for CPU).",
    )
    p.add_argument(
        "--save-img", action="store_true", default=False,
        help="Save visualised output frames / images.",
    )
    p.add_argument(
        "--save-pk", action="store_true", default=True,
        help="Save predictions as pickle file.",
    )
    p.add_argument(
        "--save-video", dest="save_video", action="store_true", default=True,
        help="(Video mode) Save visualised output video.",
    )
    p.add_argument(
        "--no-save-video", dest="save_video", action="store_false",
        help="Disable video saving.",
    )
    return p


def main():
    parser = build_parser()
    args   = parser.parse_args()

    # ── Device ────────────────────────────────────────────────────────────────
    if args.gpu >= 0 and torch.cuda.is_available():
        device = torch.device(f"cuda:{args.gpu}")
        logger.info(f"Using GPU {args.gpu}: {torch.cuda.get_device_name(args.gpu)}")
    else:
        device = torch.device("cpu")
        logger.info("Using CPU (inference will be slow).")

    # ── Load models ───────────────────────────────────────────────────────────
    t0           = time.time()
    model, cfg   = load_hybrikx_model(args.cfg, args.ckpt, device)
    det_model    = load_detector(device)
    transform    = build_transform(cfg)
    logger.info(f"Models loaded in {time.time() - t0:.1f}s")

    # ── Inference ─────────────────────────────────────────────────────────────
    os.makedirs(args.out_dir, exist_ok=True)
    t1 = time.time()

    if args.mode == "image":
        infer_image(
            args.input, model, det_model, transform, cfg, device,
            out_dir=args.out_dir, save_img=args.save_img, save_pk=args.save_pk,
        )
    elif args.mode == "video":
        infer_video(
            args.input, model, det_model, transform, cfg, device,
            out_dir=args.out_dir,
            save_img=args.save_img,
            save_pk=args.save_pk,
            save_video=args.save_video,
        )
    elif args.mode == "batch":
        infer_batch(
            args.input, model, det_model, transform, cfg, device,
            out_dir=args.out_dir, save_img=args.save_img, save_pk=args.save_pk,
        )

    logger.info(f"Total time: {time.time() - t1:.1f}s")


if __name__ == "__main__":
    main()
