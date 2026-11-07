from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
import cv2
import numpy as np
import torch
from easydict import EasyDict as edict
from hybrik.models import builder
from hybrik.utils.config import update_config
from hybrik.utils.presets import SimpleTransform3DSMPLCam
from hybrik.utils.vis import get_one_box
import time
from torchvision import transforms as T
from torchvision.models.detection import fasterrcnn_resnet50_fpn
import os
import base64
import io
from PIL import Image
import pandas as pd
from pathlib import Path
import sys
import soundfile as sf
import tempfile

# Add nutrifusion to path for food detection
PROJECT_DIR = Path(__file__).resolve().parent
sys.path.append(str(PROJECT_DIR / "nutrifusion"))

app = Flask(__name__)
CORS(app)  # Enable CORS for Flutter web app

# Global model variables
det_model = None
det_transform = None
hybrik_model = None
transformation = None
cfg = None
device = None
use_amp_det = False
use_amp_pose = False

TTS_AVAILABLE = False
tts_model = None

FOOD_MODEL_AVAILABLE = False
food_model = None
ingr_index = {}
ingr_metadata = {}

WHISPER_AVAILABLE = False
whisper_model = None

NEUTTS_DIR = None

def init_models():
    """Initialize all models once."""
    global det_model, det_transform, hybrik_model, transformation, cfg, device, use_amp_det, use_amp_pose
    global TTS_AVAILABLE, tts_model, NEUTTS_DIR
    global FOOD_MODEL_AVAILABLE, food_model, ingr_index, ingr_metadata
    global WHISPER_AVAILABLE, whisper_model


    print('Initializing HybrIK models...')

    # Select device once
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    use_amp_det = device.type == 'cuda'  # safe for detector
    use_amp_pose = False  # keep HybrIK in fp32 to avoid SVD half issues on CPU
    if torch.cuda.is_available():
        torch.backends.cudnn.benchmark = True

    # Configuration
    cfg_file = 'configs/256x192_adam_lr1e-3-hrw48_cam_2x_w_pw3d_3dhp.yaml'
    CKPT = './pretrained_models/hybrik_hrnet.pth'

    # Load config
    cfg = update_config(cfg_file)

    bbox_3d_shape = getattr(cfg.MODEL, 'BBOX_3D_SHAPE', (2000, 2000, 2000))
    bbox_3d_shape = [item * 1e-3 for item in bbox_3d_shape]
    dummpy_set = edict({
        'joint_pairs_17': None,
        'joint_pairs_24': None,
        'joint_pairs_29': None,
        'bbox_3d_shape': bbox_3d_shape
    })

    transformation = SimpleTransform3DSMPLCam(
        dummpy_set, scale_factor=cfg.DATASET.SCALE_FACTOR,
        color_factor=cfg.DATASET.COLOR_FACTOR,
        occlusion=cfg.DATASET.OCCLUSION,
        input_size=cfg.MODEL.IMAGE_SIZE,
        output_size=cfg.MODEL.HEATMAP_SIZE,
        depth_dim=cfg.MODEL.EXTRA.DEPTH_DIM,
        bbox_3d_shape=bbox_3d_shape,
        rot=cfg.DATASET.ROT_FACTOR, sigma=cfg.MODEL.EXTRA.SIGMA,
        train=False, add_dpg=False,
        loss_type=cfg.LOSS['TYPE'])

    # Load models
    print('Loading detection model...')
    det_model = fasterrcnn_resnet50_fpn(pretrained=True)
    from torchvision import transforms as T
    det_transform = T.Compose([T.ToTensor()])
    
    print('Building HybrIK model...')

    hybrik_model = builder.build_sppe(cfg.MODEL)

    print(f'Loading HybrIK weights from {CKPT}...')
    save_dict = torch.load(CKPT, map_location='cpu')
    if type(save_dict) == dict:
        model_dict = save_dict['model']
        hybrik_model.load_state_dict(model_dict)
    else:
        hybrik_model.load_state_dict(save_dict)

    # Move models to device once to avoid repeated transfers
    det_model.to(device)
    hybrik_model.to(device)
    det_model.eval()
    hybrik_model.eval()

    print('HybrIK models loaded successfully!')

    # -----------------------------------------------------------------------------
    # NeuTTS Voice Generation Setup
    # -----------------------------------------------------------------------------
    try:
        # Set eSpeak paths for phonemizer
        os.environ['PHONEMIZER_ESPEAK_LIBRARY'] = r'C:\Program Files\eSpeak NG\libespeak-ng.dll'
        os.environ['PHONEMIZER_ESPEAK_PATH'] = r'C:\Program Files\eSpeak NG\espeak-ng.exe'
        
        # Add neutts-air to path
        NEUTTS_DIR = PROJECT_DIR / "neu_tts" / "neutts-air"
        sys.path.insert(0, str(NEUTTS_DIR))
        
        from neutts import NeuTTS
        
        print('Loading NeuTTS model...')
        tts_model = NeuTTS(
            backbone_repo="neuphonic/neutts-air-q4-gguf",
            backbone_device="gpu",
            codec_repo="neuphonic/neucodec",
            codec_device="cpu",  # Use CPU for codec to save VRAM
        )
        TTS_AVAILABLE = True
        print('NeuTTS model loaded successfully!')
        
    except Exception as e:
        print(f'Warning: Could not load NeuTTS model: {e}')
        TTS_AVAILABLE = False

    # Food detection setup
    try:
        from models.models import NutriFusionNet
        
        # Food detection paths
        DEFAULT_EMBEDDINGS = PROJECT_DIR / "nutrifusion" / "embeddings" / "ingredient_embeddings_gat_v2.pt"
        LABEL_CSVS = [
            PROJECT_DIR / "nutrifusion" / "utils" / "data" / "train_labels_ingr_log.csv",
            PROJECT_DIR / "nutrifusion" / "utils" / "data" / "val_labels_ingr_log.csv",
            PROJECT_DIR / "nutrifusion" / "utils" / "data" / "test_labels_ingr_log.csv",
        ]
        INGR_METADATA = PROJECT_DIR / "nutrifusion" / "utils" / "data" / "ingredients_metadata.csv"
        
        print('Loading food detection model...')
        
        # Load ingredient mappings
        def load_ingr_index_local():
            """Build a mapping from ingredient index to ingredient name."""
            dfs = [pd.read_csv(path) for path in LABEL_CSVS if path.exists()]
            if not dfs:
                print("Warning: Ingredient label CSVs could not be read.")
                return {}
            colnames = list(dfs[0].columns[1:-1])
            return {i: name for i, name in enumerate(colnames)}
        
        def load_ingr_metadata_local():
            """Return per-ingredient (cal, fat, carb, protein) tuples."""
            if not INGR_METADATA.exists():
                print("Warning: Ingredient metadata CSV not found.")
                return {}
            df = pd.read_csv(INGR_METADATA)
            return {
                row["ingr"]: (
                    float(row["cal/g"]),
                    float(row["fat(g)"]),
                    float(row["carb(g)"]),
                    float(row["protein(g)"]),
                )
                for _, row in df.iterrows()
            }
        
        # Load food detection data
        ingr_index = load_ingr_index_local()
        ingr_metadata = load_ingr_metadata_local()
        
        # Build food model
        if DEFAULT_EMBEDDINGS.exists():
            embeddings = torch.load(DEFAULT_EMBEDDINGS, map_location=device)
            food_model = NutriFusionNet(
                num_ingr=199,
                backbone="vit",
                ingredient_embedding=embeddings,
                lstm_layers=2,
                num_layers=2,
                hidden_dim=512,
            ).to(device)
            food_model.eval()
            print('Food detection model loaded successfully!')
            FOOD_MODEL_AVAILABLE = True
        else:
            print('Warning: Food model embeddings not found. Food detection will be unavailable.')
            FOOD_MODEL_AVAILABLE = False
            food_model = None
            
    except Exception as e:
        print(f'Warning: Could not load food detection model: {e}')
        FOOD_MODEL_AVAILABLE = False
        food_model = None

    # Faster Whisper Setup
    try:
        from faster_whisper import WhisperModel
        
        print('Loading Faster Whisper model (medium)...')
        device_str = "cuda" if torch.cuda.is_available() else "cpu"
        compute_type_str = "int8_float16" if torch.cuda.is_available() else "int8"
        
        whisper_model = WhisperModel("medium", device=device_str, compute_type=compute_type_str)
        WHISPER_AVAILABLE = True
        print(f'Faster Whisper ({device_str}, {compute_type_str}) loaded successfully!')

    except Exception as e:
        print(f'Warning: Could not load Faster Whisper model: {e}')
        WHISPER_AVAILABLE = False


def detect_pose_3d(image_path):
    """Detect 3D pose landmarks from an image using HybrIK"""
    try:
        t_start = time.time()
        # Read image
        print(f"Reading image: {image_path}")
        input_image = cv2.imread(image_path)
        if input_image is None:
            print(f"Failed to read image: {image_path}")
            return None, "Failed to read image"
        
        input_image = cv2.cvtColor(input_image, cv2.COLOR_BGR2RGB)
        print(f"Image shape: {input_image.shape}")

        # Center-crop to square using the smaller side
        h, w = input_image.shape[:2]
        side = min(h, w)
        if h != w:
            x0 = (w - side) // 2
            y0 = (h - side) // 2
            input_image = input_image[y0:y0 + side, x0:x0 + side]
            print(f"Cropped to square: {input_image.shape}")
        # Downscale to 512x512 if larger; do not upscale smaller images
        if side > 512:
            input_image = cv2.resize(input_image, (512, 512), interpolation=cv2.INTER_AREA)
            print(f"Resized to 512x512: {input_image.shape}")
        
        # Save resized/cropped image for debug
        try:
            debug_img = cv2.cvtColor(input_image, cv2.COLOR_RGB2BGR)
            cv2.imwrite('debug_resized.jpg', debug_img)
            print(f"Saved debug resized image to debug_resized.jpg")
        except Exception as e:
            print(f"Failed to save debug image: {e}")
        
        # Run detection
        print("Running person detection...")
        t_det_start = time.time()
        det_input = det_transform(input_image).to(device)
        with torch.inference_mode(), torch.autocast(device_type=device.type, dtype=torch.float16, enabled=use_amp_det):
            det_output = det_model([det_input])[0]
        det_elapsed = time.time() - t_det_start
        print(f"Detection time: {det_elapsed:.3f}s")
        # Move minimal data back to CPU for bbox selection
        det_output_cpu = {
            'boxes': det_output['boxes'].detach().cpu(),
            'scores': det_output['scores'].detach().cpu()
        }
        
        print(f"Detection output - boxes: {det_output_cpu['boxes'].shape[0]}, scores: {det_output_cpu['scores'][:5] if len(det_output_cpu['scores']) > 0 else 'none'}")
        
        # Try with lower threshold
        tight_bbox = get_one_box(det_output_cpu, thrd=0.5)  # Lower threshold
        
        if tight_bbox is None:
            print("No person detected in image")
            return None, "No person detected in image. Make sure the image contains a visible person."
        
        print(f"Detected bbox: {tight_bbox}")
        
        # Run HybrIK
        print("Running HybrIK pose estimation...")
        t_pose_start = time.time()
        pose_input, bbox, img_center = transformation.test_transform(
            input_image, tight_bbox)
        pose_input = pose_input.to(device)[None, :, :, :]
        
        # Keep HybrIK in fp32 to avoid CPU SVD half support issues
        pose_input = pose_input.float()
        bboxes_t = torch.from_numpy(np.array(bbox)).to(device).unsqueeze(0).float()
        img_center_t = torch.from_numpy(img_center).to(device).unsqueeze(0).float()
        with torch.inference_mode(), torch.autocast(device_type=device.type, dtype=torch.float16, enabled=use_amp_pose):
            pose_output = hybrik_model(
                pose_input, flip_test=True,
                bboxes=bboxes_t,
                img_center=img_center_t
            )
        pose_elapsed = time.time() - t_pose_start
        print(f"Pose time: {pose_elapsed:.3f}s")
        
        print(f"Pose output keys: {list(pose_output.keys())}")
        
        # Extract 3D joints
        joints_3d = None
        used_key = None
        for key in ['pred_xyz_jts_29', 'pred_xyz_jts_24', 'pred_xyz_jts_17', 'pred_xyz_jts', 'pred_xyz_29', 'xyz_29', 'pred_xyz_17', 'xyz_17']:
            if key in pose_output:
                joints_3d = pose_output[key].detach().cpu().numpy()[0]
                used_key = key
                print(f"Found 3D joints in key: {key}, shape: {joints_3d.shape}")
                break
        
        if joints_3d is None:
            print("No 3D joint predictions found")
            return None, f"No 3D joint predictions found. Available keys: {list(pose_output.keys())}"
        
        # Get translation
        transl = np.array([0.0, 0.0, 0.0])
        for key in ['transl', 'cam_trans', 'camera_trans']:
            if key in pose_output:
                transl = pose_output[key].detach().cpu().numpy()[0]
                print(f"Found translation in key: {key}, value: {transl}")
                break
        
        # Check and fix shape if needed
        if len(joints_3d.shape) == 1:
            num_joints = len(joints_3d) // 3
            joints_3d = joints_3d.reshape(num_joints, 3)
            print(f"Reshaped joints to: {joints_3d.shape}")
        
        # Convert to world coordinates by adding translation
        joints_3d_world = joints_3d + transl
        print(f"Converted to world coordinates using translation: {transl}")
        print(f"Total joints: {len(joints_3d_world)}")
        
        # Convert to list of dicts (using world coordinates)
        landmarks_3d = []
        for i, joint in enumerate(joints_3d_world):
            landmarks_3d.append({
                'id': i,
                'x': float(joint[0]),
                'y': float(joint[1]),
                'z': float(joint[2])
            })
        
        print(f"Successfully extracted {len(landmarks_3d)} landmarks")
        total_elapsed = time.time() - t_start
        print(f"Total inference time: {total_elapsed:.3f}s")
        return landmarks_3d, None
    
    except Exception as e:
        import traceback
        error_msg = f"Error in detect_pose_3d: {e}\n{traceback.format_exc()}"
        print(error_msg)
        return None, error_msg

@app.route('/api/detect_pose', methods=['GET', 'POST'])
def detect_pose():
    """API endpoint to detect pose from hardcoded pose.jpg or uploaded image"""
    try:
        print(f"Received request: {request.method} {request.path}")
        print(f"Headers: {dict(request.headers)}")
        
        image_path = 'pose.jpg'
        is_temp = False
        
        # Check if image data is provided in the request
        if request.method == 'POST':
            data = request.get_json(silent=True)
            print(f"Request data presence: {data is not None}")
            if data:
                print(f"Image field in data: {'image' in data}")
                if 'image' in data:
                    print(f"Image data length: {len(str(data['image'])) if data['image'] else 0}")

            if data and 'image' in data and data['image']:
                # Decode and save temporary image
                try:
                    image_base64 = data['image']
                    image = decode_base64_image(image_base64)
                    
                    # Create debug directory if it doesn't exist
                    debug_dir = os.path.join(os.getcwd(), 'debug_frames')
                    if not os.path.exists(debug_dir):
                        os.makedirs(debug_dir)
                    
                    # Save with timestamp for debugging
                    timestamp = int(time.time())
                    debug_path = os.path.join(debug_dir, f'pose_{timestamp}.jpg')
                    image.save(debug_path)
                    print(f"Saved debug image to {debug_path}")
                    
                    image_path = 'temp_pose.jpg'
                    image.save(image_path)
                    is_temp = True
                    print(f"Using image provided in request")
                except Exception as e:
                    print(f"Error decoding image: {e}")
                    return jsonify({
                        'success': False,
                        'error': f'Failed to decode image: {str(e)}'
                    }), 400

        if not os.path.exists(image_path):
            return jsonify({
                'success': False,
                'error': f'Image file {image_path} not found in root directory'
            }), 404
        
        # Detect pose
        landmarks, error = detect_pose_3d(image_path)
        
        # Clean up temporary file
        if is_temp and os.path.exists(image_path):
            try:
                os.remove(image_path)
                print(f"Removed temporary image {image_path}")
            except Exception as e:
                print(f"Failed to remove temporary image {image_path}: {e}")
        
        if landmarks is None:
            return jsonify({
                'success': False,
                'error': error or 'No pose detected in image'
            }), 400
        
        return jsonify({
            'success': True,
            'landmarks': landmarks,
            'count': len(landmarks)
        })
    
    except Exception as e:
        import traceback
        error_msg = f"{str(e)}\n{traceback.format_exc()}"
        print(f"API Error: {error_msg}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def decode_base64_image(base64_string):
    """Decode base64 string to PIL Image"""
    try:
        # Remove data URL prefix if present
        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]
        
        # Decode base64
        image_data = base64.b64decode(base64_string)
        image = Image.open(io.BytesIO(image_data)).convert("RGB")
        return image
    except Exception as e:
        raise ValueError(f"Invalid base64 image: {e}")

def preprocess_food_image(image):
    """Preprocess PIL image for food detection model"""
    transform = T.Compose([
        T.Resize((224, 224)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])
    return transform(image).unsqueeze(0).to(device)

def calculate_nutrition(outputs, ingr_dict, ingr_index, k=5):
    """Convert model logits to nutrition estimates"""
    preds = outputs.squeeze(0).detach().cpu().numpy()
    idx = np.where(preds > 0.15)[0]

    calories = mass = fat = carbs = protein = 0.0
    ingredient_masses = {}

    for ingr_idx in idx:
        mass_i = np.exp(preds[ingr_idx]) - 1  # undo log transform
        ingr_name = ingr_index.get(ingr_idx, f"ingr_{ingr_idx}")
        cal_g, fat_g, carb_g, protein_g = ingr_dict.get(ingr_name, (0.0, 0.0, 0.0, 0.0))
        
        calories += mass_i * cal_g
        fat += mass_i * fat_g
        carbs += mass_i * carb_g
        protein += mass_i * protein_g
        mass += mass_i
        ingredient_masses[ingr_name] = mass_i

    # Get top ingredients
    top_ingredients = []
    if ingredient_masses:
        sorted_ingredients = sorted(ingredient_masses.items(), key=lambda x: x[1], reverse=True)
        top_ingredients = [
            {"name": name, "mass_g": float(mass)} 
            for name, mass in sorted_ingredients[:k]
        ]

    nutrition_facts = {
        "calories": float(calories),
        "total_mass_g": float(mass),
        "fat_g": float(fat),
        "carbs_g": float(carbs),
        "protein_g": float(protein),
    }
    
    return top_ingredients, nutrition_facts

def detect_food_nutrients(image):
    """Detect food nutrients from PIL image"""
    try:
        if not FOOD_MODEL_AVAILABLE:
            return None, "Food detection model not available"
        
        # Preprocess image
        image_tensor = preprocess_food_image(image)
        
        # Run inference
        with torch.no_grad():
            outputs = food_model(image_tensor)
        
        # Calculate nutrition
        top_ingredients, nutrition = calculate_nutrition(
            outputs, ingr_metadata, ingr_index, k=5
        )
        
        return nutrition, None
        
    except Exception as e:
        import traceback
        error_msg = f"Error in food detection: {e}\n{traceback.format_exc()}"
        print(error_msg)
        return None, error_msg

@app.route('/api/detect_nutrients', methods=['POST'])
def detect_food_nutrients_api():
    """API endpoint to detect food nutrients from base64 image"""
    try:
        # Check if food model is available
        if not FOOD_MODEL_AVAILABLE:
            return jsonify({
                'success': False,
                'error': 'Food detection model not available. Please ensure nutrifusion model files are present.'
            }), 503
        
        # Get request data
        data = request.get_json()
        if not data or 'image' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing image data. Please provide base64 encoded image in "image" field.'
            }), 400
        
        base64_image = data['image']
        
        # Decode base64 image
        try:
            image = decode_base64_image(base64_image)
        except ValueError as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 400
        
        # Detect food nutrients
        result, error = detect_food_nutrients(image)
        
        if result is None:
            return jsonify({
                'success': False,
                'error': error or 'Failed to detect food nutrients'
            }), 400
        
        return jsonify({
            'success': True,
            'nutrition': result
        })
    
    except Exception as e:
        import traceback
        error_msg = f"{str(e)}\n{traceback.format_exc()}"
        print(f"API Error: {error_msg}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# -----------------------------------------------------------------------------
# Voice Generation Endpoint
# -----------------------------------------------------------------------------
@app.route('/api/generate-voice', methods=['POST'])
def generate_voice_api():
    """API endpoint to generate voice using NeuTTS"""
    try:
        if not TTS_AVAILABLE:
            return jsonify({
                'success': False,
                'error': 'NeuTTS model not available. Please ensure the model is properly installed.'
            }), 503
        
        # Get request data
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'error': 'Missing request data'
            }), 400
        
        # Validate required fields
        if 'text' not in data or not data['text']:
            return jsonify({
                'success': False,
                'error': 'Missing required field: text'
            }), 400
        
        voice_name = data.get('voice', 'jo').lower() if data.get('voice') else 'jo'
        input_text = data['text']
        
        # Import voice catalog
        try:
            from voice_library import VOICE_CATALOG
        except ImportError:
            VOICE_CATALOG = {}
        
        # Validate voice name
        valid_voices = list(VOICE_CATALOG.keys()) + ['jo', 'dave']
        
        print(f"Requested voice: '{voice_name}'")
        print(f"Available voices: {valid_voices}")
        
        if voice_name not in valid_voices:
            return jsonify({
                'success': False,
                'error': f"Invalid voice name '{voice_name}'. Available voices: {', '.join(valid_voices)}"
            }), 400
        
        # Load voice reference
        print(f"Generating audio for voice: {voice_name}")
        
        # Handle legacy voices (jo, dave)
        if voice_name == 'jo':
            ref_codes = torch.load(str(NEUTTS_DIR / "samples" / "jo.pt"))
            with open(str(NEUTTS_DIR / "samples" / "jo.txt"), "r") as f:
                ref_text = f.read().strip()
        elif voice_name == 'dave':
            ref_codes = torch.load(str(NEUTTS_DIR / "samples" / "dave.pt"))
            with open(str(NEUTTS_DIR / "samples" / "dave.txt"), "r") as f:
                ref_text = f.read().strip()
        else:
            # Use voice library
            from voice_library import load_voice, get_voice_text
            try:
                ref_codes = load_voice(voice_name)
                ref_text = get_voice_text(voice_name)

            except FileNotFoundError:
                return jsonify({
                    'success': False,
                    'error': f'Voice "{voice_name}" not configured. Please add audio files and run batch encoder.'
                }), 404
        
        # Generate audio
        print(f"Generating: {input_text[:50]}...")
        t_start = time.time()
        wav = tts_model.infer(input_text, ref_codes, ref_text)
        t_elapsed = time.time() - t_start
        print(f"Audio generated in {t_elapsed:.2f}s")
        
        # Save to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp_file:
            sf.write(tmp_file.name, wav, 24000)
            tmp_path = tmp_file.name
        
        # Read and encode as base64
        with open(tmp_path, 'rb') as f:
            audio_bytes = f.read()
            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
        
        # Clean up temp file
        try:
            os.remove(tmp_path)
        except:
            pass
        
        return jsonify({
            'success': True,
            'audio_base64': audio_base64,
            'duration_seconds': len(wav) / 24000,
            'generation_time_seconds': t_elapsed,
            'voice': voice_name
        })
    
    except Exception as e:
        import traceback
        error_msg = f"{str(e)}\n{traceback.format_exc()}"
        print(f"API Error: {error_msg}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'message': 'Pose detection server is running',
        'pose_jpg_exists': os.path.exists('pose.jpg'),
        'food_detection_available': FOOD_MODEL_AVAILABLE,
        'whisper_available': WHISPER_AVAILABLE,
        'tts_available': TTS_AVAILABLE
    })

# Faster Whisper Setup is now handled in init_models()




def transcribe_audio_base64(base64_audio):
    """Transcribe base64 encoded audio using Faster Whisper"""
    if not WHISPER_AVAILABLE:
        raise RuntimeError("Whisper model is not available")

    # Save to temp file
    try:
        # Decode base64
        if ',' in base64_audio:
            base64_audio = base64_audio.split(',')[1]
        
        audio_data = base64.b64decode(base64_audio)
        
        # Create temp file (ffmpeg needs a file path usually, or pipe)
        # We'll use a named temp file. faster-whisper accepts a file path or file-like object?
        # It accepts file path or binary stream.
        
        # Using binary stream directly might be faster/cleaner
        audio_stream = io.BytesIO(audio_data)
        
        segments, info = whisper_model.transcribe(audio_stream, beam_size=5)
        
        # Collect text chunks
        transcribed_text = ""
        for segment in segments:
            transcribed_text += segment.text + " "
            
        return transcribed_text.strip()
        
    except Exception as e:
        print(f"Error during transcription: {e}")
        raise e


@app.route('/api/transcribe', methods=['POST'])
def transcribe_audio_api():
    """API endpoint to transcribe audio from base64 string"""
    try:
        if not WHISPER_AVAILABLE:
             return jsonify({
                'success': False,
                'error': 'Whisper model not available. Install faster-whisper.'
            }), 503

        data = request.get_json()
        if not data or 'audio_data' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing audio_data'
            }), 400
            
        base64_audio = data['audio_data']
        
        text = transcribe_audio_base64(base64_audio)
        
        print(f"Transcribed text: {text}")
        
        return jsonify({
            'success': True,
            'text': text
        })

    except Exception as e:
        import traceback
        error_msg = f"{str(e)}\n{traceback.format_exc()}"
        print(f"API Error: {error_msg}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500



if __name__ == '__main__':
    # Only load models in the main worker process, not the reloader
    app.debug = True
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.debug:
        init_models()
    
    print("Starting pose detection server...")
    print("Endpoints:")
    print("  - GET  /health - Health check")
    print("  - GET  /api/detect_pose - Detect pose from pose.jpg")
    print("  - POST /api/detect_pose - Detect pose from uploaded image")
    print("  - POST /api/detect_food_nutrients - Detect food nutrients from base64 image")
    print("  - POST /api/transcribe - Transcribe audio to text")
    print("  - POST /api/generate-voice - Generate voice from text")
    print(f"\nFood detection available: {FOOD_MODEL_AVAILABLE}")
    print(f"Whisper (transcription) available: {WHISPER_AVAILABLE}")
    print(f"TTS (voice generation) available: {TTS_AVAILABLE}")

    print("\nServer running on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000)


