import React, { useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { ThemedText } from './themed-text';

import { isArmBone, isLegBone, isRelevantBone } from '@/utils/pose-utils';

interface SkeletonViewerProps {
  /** Ref to the source <model-viewer> element whose skeleton we visualise */
  sourceViewerRef: React.RefObject<any>;
  style?: any;
  selectedBoneName?: string | null;
  onSelectBone?: (name: string | null) => void;
  roomTheme?: 'dark' | 'white';
  symmetricArmsEnabled?: boolean;
  symmetricLegsEnabled?: boolean;
}

/**
 * Renders the skeleton from a model-viewer's scene in a fully independent
 * Three.js WebGL renderer with its own camera and OrbitControls.
 *
 * This avoids the camera-projection mismatch that occurs when projecting
 * bones through model-viewer's internal camera onto a differently-sized canvas.
 */
export const SkeletonViewer: React.FC<SkeletonViewerProps> = ({
  sourceViewerRef,
  style,
  selectedBoneName,
  onSelectBone,
  roomTheme = 'dark',
  symmetricArmsEnabled = false,
  symmetricLegsEnabled = false,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const controlsRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const skeletonGroupRef = useRef<any>(null);
  const boneCountRef = useRef<number>(0);
  const labelCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const labelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const initializedRef = useRef(false);
  const boneVisualsRef = useRef<Map<any, { joint: any; glow: any; boneMesh?: any }>>(new Map());

  const [skeletonBuilt, setSkeletonBuilt] = React.useState(0);
  const [hoveredBoneName, setHoveredBoneName] = React.useState<string | null>(null);

  const onSelectBoneRef = useRef(onSelectBone);
  useEffect(() => {
    onSelectBoneRef.current = onSelectBone;
  }, [onSelectBone]);

  const symmetricArmsEnabledRef = useRef(symmetricArmsEnabled);
  useEffect(() => {
    symmetricArmsEnabledRef.current = symmetricArmsEnabled;
  }, [symmetricArmsEnabled]);

  const symmetricLegsEnabledRef = useRef(symmetricLegsEnabled);
  useEffect(() => {
    symmetricLegsEnabledRef.current = symmetricLegsEnabled;
  }, [symmetricLegsEnabled]);

  // Theme-aware bone color helpers
  const boneColors = React.useMemo(() => {
    if (roomTheme === 'white') {
      return {
        joint: 0x7C3AED,     // deep violet
        root: 0x1E40AF,      // deep blue
        selected: 0xFF007F,  // vivid magenta
        hovered: 0x374151,   // dark slate
        bone: 0x7C3AED,
      };
    }
    return {
      joint: 0x00ffcc,
      root: 0x208aef,
      selected: 0xffffff,
      hovered: 0x888888,
      bone: 0x00ffcc,
    };
  }, [roomTheme]);

  // Update bone highlight color when selection, hover, or skeleton changes
  useEffect(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !boneVisualsRef.current) return;

    boneVisualsRef.current.forEach((visual, bone) => {
      const isSelected = selectedBoneName === bone.name;
      const isHovered = hoveredBoneName === bone.name;
      const isRoot = !bone.parent || !bone.parent.isBone;
      const isLeft = bone.name.includes('_L_');
      const isArm = isArmBone(bone.name);
      const isLeg = isLegBone(bone.name);
      const isDisabled = ((isArm && symmetricArmsEnabled) || (isLeg && symmetricLegsEnabled)) && isLeft;

      let baseColor = isSelected ? boneColors.selected : (isHovered ? boneColors.hovered : (isRoot ? boneColors.root : boneColors.joint));
      if (isDisabled) {
        baseColor = roomTheme === 'white' ? 0xdddddd : 0x222222;
      }

      // Update joint color
      if (visual.joint && visual.joint.material) {
        visual.joint.material.color.setHex(baseColor);
      }

      // Update glow color
      if (visual.glow && visual.glow.material) {
        visual.glow.material.color.setHex(baseColor);
        visual.glow.material.opacity = isDisabled
          ? 0.05
          : (isSelected
            ? 0.4
            : (isHovered ? 0.3 : (isRoot ? 0.2 : 0.15)));
      }

      // Update bone cylinder color
      if (visual.boneMesh && visual.boneMesh.material) {
        visual.boneMesh.material.color.setHex(
          isDisabled ? (roomTheme === 'white' ? 0xdddddd : 0x222222) : (isSelected ? boneColors.selected : (isHovered ? boneColors.hovered : boneColors.bone))
        );
        visual.boneMesh.material.opacity = isDisabled
          ? 0.2
          : (isSelected
            ? 1.0
            : (isHovered ? 0.85 : 0.6));
      }
    });
  }, [selectedBoneName, hoveredBoneName, skeletonBuilt, boneColors, symmetricArmsEnabled, symmetricLegsEnabled, roomTheme]);

  /* ─── helpers to reach model-viewer internals ─── */

  const getScene = useCallback(() => {
    const viewer = sourceViewerRef.current;
    if (!viewer) return null;
    const symbols = Object.getOwnPropertySymbols(viewer);
    const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
    return sceneSym ? viewer[sceneSym] : null;
  }, [sourceViewerRef]);

  const getBones = useCallback(() => {
    const scene = getScene();
    if (!scene) return [];
    const bones: any[] = [];
    scene.traverse((child: any) => {
      if (child.isBone && isRelevantBone(child.name)) bones.push(child);
    });
    return bones;
  }, [getScene]);

  /* ─── fit camera to skeleton bounds ─── */

  const fitCameraToSkeleton = useCallback((THREE: any, group: any) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = maxDim / (2 * Math.tan(fov / 2));
    cameraZ *= 1.5; // padding

    camera.position.set(center.x, center.y, center.z + cameraZ);
    camera.near = cameraZ / 100;
    camera.far = cameraZ * 100;
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.update();
  }, []);

  /* ─── build skeleton geometry from bone data ─── */

  const buildSkeleton = useCallback(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !sceneRef.current) return;

    const bones = getBones();
    if (bones.length === 0) return;

    // Remove old skeleton group if any
    if (skeletonGroupRef.current) {
      sceneRef.current.remove(skeletonGroupRef.current);
      // Dispose geometries/materials
      skeletonGroupRef.current.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m: any) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    }

    const group = new THREE.Group();
    const visuals = new Map();

    const jointGeo = new THREE.SphereGeometry(0.008, 12, 12);
    const rootGeo = new THREE.SphereGeometry(0.012, 12, 12);
    const glowJointGeo = new THREE.SphereGeometry(0.02, 10, 10);
    const glowRootGeo = new THREE.SphereGeometry(0.03, 10, 10);

    const tempPos = new THREE.Vector3();
    const parentPos = new THREE.Vector3();

    // Derive colors from current theme — boneColors ref is used because this
    // callback is memoized and may not close over the latest boneColors state.
    const isWhite = roomTheme === 'white';
    const themeJoint = isWhite ? 0x7C3AED : 0x00ffcc;
    const themeRoot  = isWhite ? 0x1E40AF : 0x208aef;

    bones.forEach((bone) => {
      // Get world position of this bone
      tempPos.setFromMatrixPosition(bone.matrixWorld);

      const isRoot = !bone.parent || !bone.parent.isBone;

      // Unique materials for each element for independent selection coloring
      const jointMat = new THREE.MeshBasicMaterial({
        color: isRoot ? themeRoot : themeJoint,
      });
      const glowMat = new THREE.MeshBasicMaterial({
        color: isRoot ? themeRoot : themeJoint,
        transparent: true,
        opacity: isRoot ? 0.2 : 0.15,
      });

      // Joint sphere
      const joint = new THREE.Mesh(isRoot ? rootGeo : jointGeo, jointMat);
      joint.position.copy(tempPos);
      joint.userData = { boneName: bone.name };
      group.add(joint);

      // Glow sphere
      const glow = new THREE.Mesh(isRoot ? glowRootGeo : glowJointGeo, glowMat);
      glow.position.copy(tempPos);
      glow.userData = { boneName: bone.name };
      group.add(glow);

      // Bone connection to parent
      let boneMesh;
      let parentBone = bone.parent;
      while (parentBone && parentBone.isBone && !isRelevantBone(parentBone.name)) {
        parentBone = parentBone.parent;
      }
      if (parentBone && parentBone.isBone) {
        parentPos.setFromMatrixPosition(parentBone.matrixWorld);

        const dir = new THREE.Vector3().subVectors(tempPos, parentPos);
        const length = dir.length();
        
        // Base cylinder geometry aligned along Y-axis with unit length
        const boneGeo = new THREE.CylinderGeometry(0.003, 0.003, 1, 6);
        // Translate pivot to base
        boneGeo.translate(0, 0.5, 0);

        const boneMat = new THREE.MeshBasicMaterial({
          color: isWhite ? 0x7C3AED : 0x00ffcc,
          transparent: true,
          opacity: 0.6,
        });

        boneMesh = new THREE.Mesh(boneGeo, boneMat);
        boneMesh.position.copy(parentPos);
        boneMesh.userData = { boneName: bone.name };

        // Thicker invisible cylinder to act as virtual padding for hover / selection
        const hitGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6);
        hitGeo.translate(0, 0.5, 0);
        const hitMat = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        const hitMesh = new THREE.Mesh(hitGeo, hitMat);
        hitMesh.userData = { boneName: bone.name };
        boneMesh.add(hitMesh);

        if (length > 0.0001) {
          boneMesh.scale.set(1, length, 1);
          const up = new THREE.Vector3(0, 1, 0);
          boneMesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
        } else {
          boneMesh.visible = false;
        }
        group.add(boneMesh);
      }

      visuals.set(bone, { joint, glow, boneMesh });
    });

    sceneRef.current.add(group);
    skeletonGroupRef.current = group;
    boneVisualsRef.current = visuals;
    boneCountRef.current = bones.length;

    // Auto-fit camera to skeleton bounds
    fitCameraToSkeleton(THREE, group);

    // Notify colors useEffect to apply selected highlight
    setSkeletonBuilt((prev) => prev + 1);
  }, [getBones, fitCameraToSkeleton]);

  /* ─── update skeleton positions each frame ─── */

  const updateSkeletonPositions = useCallback(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !skeletonGroupRef.current || !boneVisualsRef.current) return;

    const bones = getBones();
    if (bones.length === 0) return;

    // If bone count changed, rebuild entirely
    if (bones.length !== boneCountRef.current) {
      buildSkeleton();
      return;
    }

    const tempPos = new THREE.Vector3();
    const parentPos = new THREE.Vector3();

    boneVisualsRef.current.forEach((visual, bone) => {
      tempPos.setFromMatrixPosition(bone.matrixWorld);

      // Update joint & glow positions
      if (visual.joint) {
        visual.joint.position.copy(tempPos);
      }
      if (visual.glow) {
        visual.glow.position.copy(tempPos);
      }

      // Update bone cylinder position, scale, and rotation
      let parentBone = bone.parent;
      while (parentBone && parentBone.isBone && !isRelevantBone(parentBone.name)) {
        parentBone = parentBone.parent;
      }
      if (visual.boneMesh && parentBone && parentBone.isBone) {
        parentPos.setFromMatrixPosition(parentBone.matrixWorld);

        const dir = new THREE.Vector3().subVectors(tempPos, parentPos);
        const length = dir.length();

        visual.boneMesh.position.copy(parentPos);

        if (length > 0.0001) {
          visual.boneMesh.visible = true;
          visual.boneMesh.scale.set(1, length, 1);
          const up = new THREE.Vector3(0, 1, 0);
          visual.boneMesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
        } else {
          visual.boneMesh.visible = false;
        }
      }
    });
  }, [getBones, buildSkeleton]);

  /* ─── draw overlay label ─── */

  const drawLabel = useCallback(() => {
    const canvas = labelCanvasRef.current;
    const ctx = labelCtxRef.current;
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Bone count label
    if (boneCountRef.current > 0) {
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(`${boneCountRef.current} bones`, 12, h - 12);
    }
  }, []);

  /* ─── initialize Three.js scene ─── */

  const initScene = useCallback(() => {
    const THREE = (window as any).THREE;
    const mount = mountRef.current;
    if (!THREE || !mount || initializedRef.current) return;

    initializedRef.current = true;

    const rect = mount.getBoundingClientRect();
    const w = rect.width || 400;
    const h = rect.height || 480;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(roomTheme === 'white' ? 0xf8f8f8 : 0x050505);
    sceneRef.current = scene;

    // Subtle grid
    const gridHelper = new THREE.GridHelper(
      4, 40,
      roomTheme === 'white' ? 0xcccccc : 0x111111,
      roomTheme === 'white' ? 0xe8e8e8 : 0x0a0a0a
    );
    gridHelper.position.y = -1;
    scene.add(gridHelper);

    // Camera
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 100);
    camera.position.set(0, 1, 3);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Pointer variables to track clicks vs orbits
    let startX = 0;
    let startY = 0;
    let startTime = 0;

    const onPointerDown = (e: PointerEvent) => {
      startX = e.clientX;
      startY = e.clientY;
      startTime = Date.now();
    };

    const onPointerUp = (e: PointerEvent) => {
      const diffX = Math.abs(e.clientX - startX);
      const diffY = Math.abs(e.clientY - startY);
      const duration = Date.now() - startTime;

      if (diffX < 5 && diffY < 5 && duration < 300) {
        const domRect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2();
        mouse.x = ((e.clientX - domRect.left) / domRect.width) * 2 - 1;
        mouse.y = -((e.clientY - domRect.top) / domRect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);

        if (skeletonGroupRef.current) {
          const intersects = raycaster.intersectObjects(skeletonGroupRef.current.children, true);
          if (intersects.length > 0) {
            const clickedObj = intersects.find((item: any) => item.object.userData && item.object.userData.boneName);
            if (clickedObj) {
              const name = clickedObj.object.userData.boneName;
              const isArm = isArmBone(name);
              const isLeg = isLegBone(name);
              const isSymmetric = (isArm && symmetricArmsEnabledRef.current) || (isLeg && symmetricLegsEnabledRef.current);
              if (isSymmetric && name.includes('_L_')) {
                return;
              }
              onSelectBoneRef.current?.(name);
              return;
            }
          }
          onSelectBoneRef.current?.(null);
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const domRect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2();
      mouse.x = ((e.clientX - domRect.left) / domRect.width) * 2 - 1;
      mouse.y = -((e.clientY - domRect.top) / domRect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      if (skeletonGroupRef.current) {
        const intersects = raycaster.intersectObjects(skeletonGroupRef.current.children, true);
        if (intersects.length > 0) {
          const hoveredObj = intersects.find((item: any) => item.object.userData && item.object.userData.boneName);
          if (hoveredObj) {
            const name = hoveredObj.object.userData.boneName;
            const isArm = isArmBone(name);
            const isLeg = isLegBone(name);
            const isSymmetric = (isArm && symmetricArmsEnabledRef.current) || (isLeg && symmetricLegsEnabledRef.current);
            if (isSymmetric && name.includes('_L_')) {
              setHoveredBoneName(null);
              renderer.domElement.style.cursor = 'auto';
              return;
            }
            setHoveredBoneName(name);
            renderer.domElement.style.cursor = 'pointer';
            return;
          }
        }
      }
      setHoveredBoneName(null);
      renderer.domElement.style.cursor = 'auto';
    };

    const onPointerLeave = () => {
      setHoveredBoneName(null);
      renderer.domElement.style.cursor = 'auto';
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);

    // Save handler references to remove them during cleanup
    (renderer as any)._onPointerDown = onPointerDown;
    (renderer as any)._onPointerUp = onPointerUp;
    (renderer as any)._onPointerMove = onPointerMove;
    (renderer as any)._onPointerLeave = onPointerLeave;

    // Label overlay canvas
    const labelCanvas = document.createElement('canvas');
    labelCanvas.style.position = 'absolute';
    labelCanvas.style.top = '0';
    labelCanvas.style.left = '0';
    labelCanvas.style.width = '100%';
    labelCanvas.style.height = '100%';
    labelCanvas.style.pointerEvents = 'none';
    labelCanvas.style.zIndex = '5';
    mount.appendChild(labelCanvas);
    labelCanvasRef.current = labelCanvas;
    labelCtxRef.current = labelCanvas.getContext('2d');

    // OrbitControls — load inline since we already have THREE on window
    const controls = createOrbitControls(THREE, camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = true;
    controls.enablePan = false;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 1.0;
    controlsRef.current = controls;

    // Ambient light (subtle, bones are MeshBasic so this is for future use)
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // Animation loop
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      controls.update();
      updateSkeletonPositions();
      renderer.render(scene, camera);
      drawLabel();
    };

    // Build initial skeleton
    buildSkeleton();
    animate();
  }, [buildSkeleton, updateSkeletonPositions, drawLabel]);

  /* ─── mount / unmount ─── */

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    // Wait for THREE and model bones to be ready
    const checkReady = setInterval(() => {
      const THREE = (window as any).THREE;
      const bones = getBones();
      if (THREE && bones.length > 0) {
        clearInterval(checkReady);
        initScene();
      }
    }, 200);

    return () => {
      clearInterval(checkReady);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (rendererRef.current) {
        if (rendererRef.current._onPointerDown) {
          rendererRef.current.domElement.removeEventListener('pointerdown', rendererRef.current._onPointerDown);
        }
        if (rendererRef.current._onPointerUp) {
          rendererRef.current.domElement.removeEventListener('pointerup', rendererRef.current._onPointerUp);
        }
        if (rendererRef.current._onPointerMove) {
          rendererRef.current.domElement.removeEventListener('pointermove', rendererRef.current._onPointerMove);
        }
        if (rendererRef.current._onPointerLeave) {
          rendererRef.current.domElement.removeEventListener('pointerleave', rendererRef.current._onPointerLeave);
        }
        rendererRef.current.dispose();
        if (mountRef.current && rendererRef.current.domElement.parentNode === mountRef.current) {
          mountRef.current.removeChild(rendererRef.current.domElement);
        }
        rendererRef.current = null;
      }
      if (labelCanvasRef.current && mountRef.current) {
        if (labelCanvasRef.current.parentNode === mountRef.current) {
          mountRef.current.removeChild(labelCanvasRef.current);
        }
        labelCanvasRef.current = null;
      }
      initializedRef.current = false;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      skeletonGroupRef.current = null;
    };
  }, [initScene, getBones]);

  /* ─── resize handler ─── */

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleResize = () => {
      const mount = mountRef.current;
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      if (!mount || !renderer || !camera) return;

      const rect = mount.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  /* ─── render ─── */

  if (Platform.OS !== 'web') {
    return (
      <View style={[styles.container, styles.fallback, style]}>
        <ThemedText type="smallBold">Skeleton View (Web Only)</ThemedText>
      </View>
    );
  }

  return (
    <View style={[
      styles.container,
      roomTheme === 'white' && { backgroundColor: '#f8f8f8' },
      style
    ]}>
      <div
        ref={mountRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          borderRadius: 24,
          overflow: 'hidden',
        }}
      />
    </View>
  );
};

/* ─── Minimal OrbitControls implementation ─── */
/* Avoids needing an external import for three/examples/jsm/controls/OrbitControls */

function createOrbitControls(THREE: any, camera: any, domElement: HTMLElement) {
  const scope: any = {
    enabled: true,
    target: new THREE.Vector3(),
    enableDamping: false,
    dampingFactor: 0.05,
    enableZoom: true,
    enablePan: true,
    autoRotate: false,
    autoRotateSpeed: 2.0,
    enableRotate: true,
    rotateSpeed: 1.0,
    zoomSpeed: 1.0,
  };

  let spherical = new THREE.Spherical();
  let sphericalDelta = new THREE.Spherical();
  let scale = 1;
  let panOffset = new THREE.Vector3();
  let rotateStart = new THREE.Vector2();
  let rotateEnd = new THREE.Vector2();
  let rotateDelta = new THREE.Vector2();
  let isPointerDown = false;
  let pointerType = '';

  const EPS = 0.000001;
  const twoPI = 2 * Math.PI;

  function getAutoRotationAngle() {
    return ((2 * Math.PI) / 60 / 60) * scope.autoRotateSpeed;
  }

  function getZoomScale() {
    return Math.pow(0.95, scope.zoomSpeed);
  }

  scope.update = function () {
    const offset = new THREE.Vector3();
    const quat = new THREE.Quaternion().setFromUnitVectors(
      camera.up,
      new THREE.Vector3(0, 1, 0)
    );
    const quatInverse = quat.clone().invert();

    const lastPosition = new THREE.Vector3();
    const lastQuaternion = new THREE.Quaternion();

    return function () {
      const position = camera.position;
      offset.copy(position).sub(scope.target);
      offset.applyQuaternion(quat);

      spherical.setFromVector3(offset);

      if (scope.autoRotate) {
        spherical.theta += getAutoRotationAngle();
      }

      spherical.theta += sphericalDelta.theta;
      spherical.phi += sphericalDelta.phi;

      // Clamp phi
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
      spherical.radius *= scale;
      spherical.radius = Math.max(0.1, Math.min(50, spherical.radius));

      scope.target.add(panOffset);

      offset.setFromSpherical(spherical);
      offset.applyQuaternion(quatInverse);

      position.copy(scope.target).add(offset);
      camera.lookAt(scope.target);

      if (scope.enableDamping) {
        sphericalDelta.theta *= 1 - scope.dampingFactor;
        sphericalDelta.phi *= 1 - scope.dampingFactor;
      } else {
        sphericalDelta.set(0, 0, 0);
      }

      scale = 1;
      panOffset.set(0, 0, 0);

      if (
        lastPosition.distanceToSquared(camera.position) > EPS ||
        8 * (1 - lastQuaternion.dot(camera.quaternion)) > EPS
      ) {
        lastPosition.copy(camera.position);
        lastQuaternion.copy(camera.quaternion);
        return true;
      }
      return false;
    };
  }();

  function onPointerDown(event: PointerEvent) {
    if (!scope.enabled) return;
    isPointerDown = true;
    pointerType = event.pointerType;

    if (event.button === 0 || event.pointerType === 'touch') {
      rotateStart.set(event.clientX, event.clientY);
    }

    domElement.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!scope.enabled || !isPointerDown) return;

    rotateEnd.set(event.clientX, event.clientY);
    rotateDelta.subVectors(rotateEnd, rotateStart).multiplyScalar(scope.rotateSpeed);

    const rect = domElement.getBoundingClientRect();
    sphericalDelta.theta -= (twoPI * rotateDelta.x) / rect.height;
    sphericalDelta.phi -= (twoPI * rotateDelta.y) / rect.height;

    rotateStart.copy(rotateEnd);
  }

  function onPointerUp(event: PointerEvent) {
    isPointerDown = false;
    domElement.releasePointerCapture(event.pointerId);
  }

  function onWheel(event: WheelEvent) {
    if (!scope.enabled || !scope.enableZoom) return;
    event.preventDefault();

    if (event.deltaY > 0) {
      scale *= getZoomScale();
    } else if (event.deltaY < 0) {
      scale /= getZoomScale();
    }
  }

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('wheel', onWheel, { passive: false });

  scope.dispose = function () {
    domElement.removeEventListener('pointerdown', onPointerDown);
    domElement.removeEventListener('pointermove', onPointerMove);
    domElement.removeEventListener('pointerup', onPointerUp);
    domElement.removeEventListener('wheel', onWheel);
  };

  return scope;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
    backgroundColor: '#050505',
    position: 'relative',
  } as any,
  fallback: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
});
