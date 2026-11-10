import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  Download,
  Sliders,
  RotateCcw,
  Sparkles,
  Maximize2,
  Box,
} from "lucide-react";

interface AvatarViewer3DProps {
  glbUrl?: string | null;
  stylizedImageUrl?: string | null;
}

// ARKit 52 Canonical Blendshapes
const ARKIT_SHAPES = [
  "eyeBlinkLeft", "eyeLookDownLeft", "eyeLookInLeft", "eyeLookOutLeft", "eyeLookUpLeft", "eyeSquintLeft", "eyeWideLeft",
  "eyeBlinkRight", "eyeLookDownRight", "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight", "eyeSquintRight", "eyeWideRight",
  "jawForward", "jawLeft", "jawRight", "jawOpen",
  "mouthClose", "mouthFunnel", "mouthPucker", "mouthLeft", "mouthRight",
  "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
  "mouthDimpleLeft", "mouthDimpleRight", "mouthStretchLeft", "mouthStretchRight",
  "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
  "mouthPressLeft", "mouthPressRight", "mouthLowerDownLeft", "mouthLowerDownRight",
  "mouthUpperUpLeft", "mouthUpperUpRight",
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
  "noseSneerLeft", "noseSneerRight",
  "tongueOut"
];

// Emotion Expression Presets
export const EXPRESSION_PRESETS: Record<string, { label: string; icon: string; weights: Record<string, number> }> = {
  neutral: {
    label: "Neutral",
    icon: "😐",
    weights: {},
  },
  laughing: {
    label: "Laughing",
    icon: "😆",
    weights: {
      jawOpen: 0.65,
      mouthSmileLeft: 0.95,
      mouthSmileRight: 0.95,
      cheekSquintLeft: 0.80,
      cheekSquintRight: 0.80,
      eyeSquintLeft: 0.70,
      eyeSquintRight: 0.70,
      browInnerUp: 0.40,
    },
  },
  crying: {
    label: "Crying",
    icon: "😭",
    weights: {
      mouthFrownLeft: 0.90,
      mouthFrownRight: 0.90,
      browInnerUp: 0.95,
      browDownLeft: 0.45,
      browDownRight: 0.45,
      eyeSquintLeft: 0.75,
      eyeSquintRight: 0.75,
      jawOpen: 0.25,
      mouthStretchLeft: 0.60,
      mouthStretchRight: 0.60,
      cheekSquintLeft: 0.40,
      cheekSquintRight: 0.40,
    },
  },
  confused: {
    label: "Confused",
    icon: "🤨",
    weights: {
      browOuterUpRight: 0.90,
      browDownLeft: 0.80,
      mouthLeft: 0.45,
      mouthSmileLeft: 0.30,
      eyeWideRight: 0.40,
      jawLeft: 0.35,
    },
  },
  shocked: {
    label: "Shocked",
    icon: "😱",
    weights: {
      jawOpen: 0.95,
      eyeWideLeft: 0.95,
      eyeWideRight: 0.95,
      browInnerUp: 0.90,
      browOuterUpLeft: 0.80,
      browOuterUpRight: 0.80,
      mouthFunnel: 0.65,
    },
  },
  happy: {
    label: "Happy",
    icon: "😊",
    weights: {
      mouthSmileLeft: 0.85,
      mouthSmileRight: 0.85,
      cheekSquintLeft: 0.55,
      cheekSquintRight: 0.55,
      browInnerUp: 0.20,
    },
  },
  angry: {
    label: "Angry",
    icon: "😠",
    weights: {
      browDownLeft: 0.95,
      browDownRight: 0.95,
      noseSneerLeft: 0.75,
      noseSneerRight: 0.75,
      mouthFrownLeft: 0.65,
      mouthFrownRight: 0.65,
      eyeSquintLeft: 0.60,
      eyeSquintRight: 0.60,
    },
  },
};

export const AvatarViewer3D: React.FC<AvatarViewer3DProps> = ({
  glbUrl,
  stylizedImageUrl: _stylizedImageUrl,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [activePreset, setActivePreset] = useState<string>("neutral");
  const [blendshapeWeights, setBlendshapeWeights] = useState<Record<string, number>>({});
  const [showWireframe, setShowWireframe] = useState<boolean>(false);
  const [showSkeleton, setShowSkeleton] = useState<boolean>(false);
  const [activeCategory, setActiveCategory] = useState<string>("emotions");

  // Three.js References
  const avatarMeshRef = useRef<THREE.Mesh | null>(null);
  const skeletonHelperRef = useRef<THREE.SkeletonHelper | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // Initialize Three.js scene
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x13151b);
    sceneRef.current = scene;

    // 2. Camera (focused on avatar head and upper torso)
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 1.62, 1.15);

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 1.58, 0);
    controls.minDistance = 0.5;
    controls.maxDistance = 3.5;
    controls.maxPolarAngle = Math.PI / 1.7;

    // 5. Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xfff5ea, 1.2);
    scene.add(ambientLight);

    // Key Light (Warm, high front-right)
    const keyLight = new THREE.DirectionalLight(0xffecd2, 2.0);
    keyLight.position.set(1.5, 2.5, 2.0);
    scene.add(keyLight);

    // Fill Light (Cool, front-left)
    const fillLight = new THREE.DirectionalLight(0xdbeafe, 1.0);
    fillLight.position.set(-1.5, 1.8, 1.5);
    scene.add(fillLight);

    // Rim Light (Sharp Pixar edge highlight from behind)
    const rimLight = new THREE.DirectionalLight(0xa78bfa, 2.2);
    rimLight.position.set(0, 2.2, -1.8);
    scene.add(rimLight);

    // Ground shadow receiver circle
    const shadowGeo = new THREE.CircleGeometry(0.8, 32);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x0a0c10,
      transparent: true,
      opacity: 0.6,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 1.0;
    scene.add(shadowMesh);

    // 6. Build Interactive Avatar Mesh with all 52 ARKit Blendshapes
    const loader = new GLTFLoader();
    const effectiveGlbUrl = glbUrl
      ? (glbUrl.startsWith("http") ? glbUrl : `http://localhost:5000${glbUrl}`)
      : null;

    if (effectiveGlbUrl) {
      loader.load(
        effectiveGlbUrl,
        (gltf) => {
          const root = gltf.scene;
          scene.add(root);

          let foundMesh: THREE.Mesh | null = null;
          root.traverse((child) => {
            if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).morphTargetInfluences) {
              foundMesh = child as THREE.Mesh;
            }
          });

          if (foundMesh) {
            avatarMeshRef.current = foundMesh;
          }

          const helper = new THREE.SkeletonHelper(root);
          helper.visible = false;
          scene.add(helper);
          skeletonHelperRef.current = helper;
        },
        undefined,
        (err) => {
          console.warn("Could not load GLB from backend, generating live procedural Pixar avatar:", err);
          createProceduralAvatar(scene);
        }
      );
    } else {
      createProceduralAvatar(scene);
    }

    // Animation Loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      if (container) container.innerHTML = "";
    };
  }, [glbUrl]);

  // Procedural 3D Pixar Head Generator with Full 52 ARKit Morph Targets
  const createProceduralAvatar = (scene: THREE.Scene) => {
    // Head Sphere with Pixar proportions
    const geometry = new THREE.SphereGeometry(0.22, 48, 48);
    const posAttr = geometry.attributes.position;
    const count = posAttr.count;

    // Pixar proportions shaping
    for (let i = 0; i < count; i++) {
      let x = posAttr.getX(i);
      let y = posAttr.getY(i);
      let z = posAttr.getZ(i);

      if (y > 0) {
        x *= 1.12;
        z *= 1.08;
      } else {
        const taper = 1.0 - ((-y) / 0.22) * 0.35;
        x *= taper;
        z *= taper;
      }
      posAttr.setXYZ(i, x, y + 1.62, z + 0.02);
    }
    geometry.computeVertexNormals();

    // 52 ARKit Morph Targets
    const morphPositions: THREE.BufferAttribute[] = [];
    const targetDict: Record<string, number> = {};

    ARKIT_SHAPES.forEach((shapeName, index) => {
      const deltaArray = new Float32Array(count * 3);
      targetDict[shapeName] = index;

      for (let i = 0; i < count; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        const z = posAttr.getZ(i);

        let dx = 0;
        let dy = 0;
        let dz = 0;

        const isFace = z > 0.05 && y >= 1.50 && y <= 1.76;
        const isJaw = z > 0.04 && y >= 1.48 && y <= 1.60;
        const isMouth = z > 0.12 && y >= 1.52 && y <= 1.62;
        const isLeftEye = z > 0.10 && y >= 1.65 && y <= 1.76 && x > 0.01;
        const isRightEye = z > 0.10 && y >= 1.65 && y <= 1.76 && x < -0.01;
        const isBrowLeft = z > 0.11 && y >= 1.70 && y <= 1.78 && x > 0.01;
        const isBrowRight = z > 0.11 && y >= 1.70 && y <= 1.78 && x < -0.01;

        if (shapeName === "jawOpen" && isJaw) {
          const factor = (1.60 - y) / 0.12;
          dy = -0.045 * factor;
          dz = 0.012 * factor;
        } else if (shapeName === "mouthSmileLeft" && isMouth && x > 0) {
          const dist = Math.sqrt(x * x + Math.pow(y - 1.57, 2));
          const falloff = Math.max(0, 1.0 - dist / 0.12);
          dx = 0.022 * falloff;
          dy = 0.035 * falloff;
          dz = 0.010 * falloff;
        } else if (shapeName === "mouthSmileRight" && isMouth && x < 0) {
          const dist = Math.sqrt(x * x + Math.pow(y - 1.57, 2));
          const falloff = Math.max(0, 1.0 - dist / 0.12);
          dx = -0.022 * falloff;
          dy = 0.035 * falloff;
          dz = 0.010 * falloff;
        } else if (shapeName === "mouthFrownLeft" && isMouth && x > 0) {
          dy = -0.028;
        } else if (shapeName === "mouthFrownRight" && isMouth && x < 0) {
          dy = -0.028;
        } else if (shapeName === "mouthPucker" && isMouth) {
          dz = 0.035;
          dx = -x * 0.45;
          dy = -(y - 1.57) * 0.40;
        } else if (shapeName === "mouthFunnel" && isMouth) {
          dz = 0.028;
          dy = -(y - 1.57) * 0.30;
        } else if (shapeName === "eyeBlinkLeft" && isLeftEye) {
          dy = y > 1.70 ? -0.024 : 0.012;
        } else if (shapeName === "eyeBlinkRight" && isRightEye) {
          dy = y > 1.70 ? -0.024 : 0.012;
        } else if (shapeName === "eyeWideLeft" && isLeftEye) {
          dy = y > 1.70 ? 0.018 : -0.010;
        } else if (shapeName === "eyeWideRight" && isRightEye) {
          dy = y > 1.70 ? 0.018 : -0.010;
        } else if (shapeName === "eyeSquintLeft" && isLeftEye) {
          dy = y < 1.70 ? 0.012 : -0.008;
        } else if (shapeName === "eyeSquintRight" && isRightEye) {
          dy = y < 1.70 ? 0.012 : -0.008;
        } else if (shapeName === "browInnerUp" && (isBrowLeft || isBrowRight)) {
          dy = 0.032;
        } else if (shapeName === "browDownLeft" && isBrowLeft) {
          dy = -0.025;
        } else if (shapeName === "browDownRight" && isBrowRight) {
          dy = -0.025;
        } else if (shapeName === "browOuterUpRight" && isBrowRight && x < -0.04) {
          dy = 0.028;
        } else if (shapeName === "browOuterUpLeft" && isBrowLeft && x > 0.04) {
          dy = 0.028;
        } else if (shapeName === "cheekSquintLeft" && isFace && x > 0.02) {
          dy = 0.020;
          dz = 0.010;
        } else if (shapeName === "cheekSquintRight" && isFace && x < -0.02) {
          dy = 0.020;
          dz = 0.010;
        } else if (shapeName === "mouthLeft" && isMouth) {
          dx = 0.025;
        } else if (shapeName === "mouthRight" && isMouth) {
          dx = -0.025;
        } else if (shapeName === "jawLeft" && isJaw) {
          dx = 0.020;
        }

        deltaArray[i * 3] = dx;
        deltaArray[i * 3 + 1] = dy;
        deltaArray[i * 3 + 2] = dz;
      }

      morphPositions.push(new THREE.BufferAttribute(deltaArray, 3));
    });

    geometry.morphAttributes.position = morphPositions;

    // Pixar Stylized PBR Material
    const material = new THREE.MeshStandardMaterial({
      color: 0xf4caa8,
      roughness: 0.65,
      metalness: 0.05,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.morphTargetDictionary = targetDict;
    mesh.morphTargetInfluences = new Array(ARKIT_SHAPES.length).fill(0);
    scene.add(mesh);
    avatarMeshRef.current = mesh;

    // Add Stylized Hair
    const hairGeo = new THREE.SphereGeometry(0.24, 32, 32);
    const hairMat = new THREE.MeshStandardMaterial({
      color: 0x4a2c1d,
      roughness: 0.8,
    });
    const hairMesh = new THREE.Mesh(hairGeo, hairMat);
    hairMesh.position.set(0, 1.68, -0.02);
    scene.add(hairMesh);

    // Add Stylized Eyes
    const eyeGeo = new THREE.SphereGeometry(0.045, 24, 24);
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.1,
    });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(0.065, 1.68, 0.18);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(-0.065, 1.68, 0.18);
    scene.add(leftEye);
    scene.add(rightEye);

    // Pupils
    const pupilGeo = new THREE.SphereGeometry(0.022, 16, 16);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x2458a0 });
    const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
    leftPupil.position.set(0.065, 1.68, 0.215);
    const rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
    rightPupil.position.set(-0.065, 1.68, 0.215);
    scene.add(leftPupil);
    scene.add(rightPupil);

    // Torso / Clothing
    const torsoGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.5, 32);
    const torsoMat = new THREE.MeshStandardMaterial({
      color: 0x3b5998,
      roughness: 0.7,
    });
    const torsoMesh = new THREE.Mesh(torsoGeo, torsoMat);
    torsoMesh.position.set(0, 1.25, 0);
    scene.add(torsoMesh);
  };

  // Apply Morph Target Influences to Three.js Mesh
  const applyBlendshapes = (weights: Record<string, number>) => {
    const mesh = avatarMeshRef.current;
    if (!mesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;

    // Reset all to zero
    for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
      mesh.morphTargetInfluences[i] = 0;
    }

    // Apply active weights
    Object.entries(weights).forEach(([name, val]) => {
      const idx = mesh.morphTargetDictionary![name];
      if (idx !== undefined && mesh.morphTargetInfluences) {
        mesh.morphTargetInfluences[idx] = Math.max(0, Math.min(1, val));
      }
    });
  };

  // Trigger Expression Preset
  const handleSelectPreset = (presetKey: string) => {
    setActivePreset(presetKey);
    const preset = EXPRESSION_PRESETS[presetKey];
    if (preset) {
      setBlendshapeWeights(preset.weights);
      applyBlendshapes(preset.weights);
    }
  };

  // Handle individual slider change
  const handleSliderChange = (shapeName: string, val: number) => {
    const updated = { ...blendshapeWeights, [shapeName]: val };
    setBlendshapeWeights(updated);
    setActivePreset("custom");
    applyBlendshapes(updated);
  };

  // Toggle Wireframe
  const toggleWireframe = () => {
    const nextVal = !showWireframe;
    setShowWireframe(nextVal);
    if (avatarMeshRef.current) {
      const mat = avatarMeshRef.current.material as any;
      if (Array.isArray(mat)) {
        mat.forEach((m: any) => (m.wireframe = nextVal));
      } else if (mat) {
        mat.wireframe = nextVal;
      }
    }
  };

  // Toggle Skeleton
  const toggleSkeleton = () => {
    const nextVal = !showSkeleton;
    setShowSkeleton(nextVal);
    if (skeletonHelperRef.current) {
      skeletonHelperRef.current.visible = nextVal;
    }
  };

  const handleDownload = () => {
    if (!glbUrl) return;
    const downloadUrl = glbUrl.startsWith("http")
      ? glbUrl
      : `http://localhost:5000${glbUrl}`;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = "pixar_avatar_arkit.glb";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Grouped Blendshapes for Sliders
  const categories: Record<string, string[]> = {
    emotions: ["jawOpen", "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight", "browInnerUp", "browDownLeft", "browDownRight"],
    jaw_mouth: ["jawOpen", "jawForward", "jawLeft", "jawRight", "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight", "mouthPucker", "mouthFunnel", "mouthLeft", "mouthRight"],
    eyes: ["eyeBlinkLeft", "eyeBlinkRight", "eyeWideLeft", "eyeWideRight", "eyeSquintLeft", "eyeSquintRight"],
    brows: ["browInnerUp", "browDownLeft", "browDownRight", "browOuterUpLeft", "browOuterUpRight"],
    cheeks_nose: ["cheekPuff", "cheekSquintLeft", "cheekSquintRight", "noseSneerLeft", "noseSneerRight", "tongueOut"],
  };

  return (
    <div className="avatar-viewer-container">
      {/* 3D WebGL Canvas Viewport */}
      <div className="viewport-wrapper" ref={mountRef}>
        {/* Floating Controls Overlay */}
        <div className="viewport-toolbar">
          <button
            className={`tool-btn ${showWireframe ? "active" : ""}`}
            onClick={toggleWireframe}
            title="Toggle Wireframe"
          >
            <Box size={16} /> <span>Wireframe</span>
          </button>
          <button
            className={`tool-btn ${showSkeleton ? "active" : ""}`}
            onClick={toggleSkeleton}
            title="Toggle Bone Skeleton"
          >
            <Maximize2 size={16} /> <span>Skeleton</span>
          </button>
          {glbUrl && (
            <button
              className="tool-btn highlight"
              onClick={handleDownload}
              title="Download Animation-Ready GLB"
            >
              <Download size={16} /> <span>Download GLB</span>
            </button>
          )}
        </div>

        {/* Floating Expression Pill Indicator */}
        <div className="current-expression-pill">
          <span>{EXPRESSION_PRESETS[activePreset]?.icon || "✨"}</span>
          <span>{EXPRESSION_PRESETS[activePreset]?.label || "Custom Expression"}</span>
        </div>
      </div>

      {/* Control Panel: Expression Presets & ARKit Sliders */}
      <div className="animation-control-panel">
        <div className="panel-section">
          <div className="section-title">
            <Sparkles size={16} />
            <span>ARKit Expression Presets</span>
          </div>
          <div className="preset-grid">
            {Object.entries(EXPRESSION_PRESETS).map(([key, item]) => (
              <button
                key={key}
                className={`preset-btn ${activePreset === key ? "active" : ""}`}
                onClick={() => handleSelectPreset(key)}
              >
                <span className="preset-icon">{item.icon}</span>
                <span className="preset-label">{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tabbed ARKit Blendshape Sliders */}
        <div className="panel-section">
          <div className="section-title">
            <Sliders size={16} />
            <span>52 ARKit Blendshape Target Controls</span>
          </div>

          <div className="category-tabs">
            {Object.keys(categories).map((cat) => (
              <button
                key={cat}
                className={`tab-btn ${activeCategory === cat ? "active" : ""}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat.replace("_", " ").toUpperCase()}
              </button>
            ))}
          </div>

          <div className="sliders-scroll-list">
            {(categories[activeCategory] || []).map((shape) => {
              const weight = blendshapeWeights[shape] || 0;
              return (
                <div key={shape} className="slider-row">
                  <div className="slider-label-row">
                    <span className="shape-name">{shape}</span>
                    <span className="shape-val">{(weight * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={weight}
                    onChange={(e) =>
                      handleSliderChange(shape, parseFloat(e.target.value))
                    }
                    className="arkit-range-slider"
                  />
                </div>
              );
            })}
          </div>

          <div className="panel-footer-actions">
            <button
              className="reset-btn"
              onClick={() => handleSelectPreset("neutral")}
            >
              <RotateCcw size={14} /> <span>Reset to Neutral</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
