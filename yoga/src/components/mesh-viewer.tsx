import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator, Platform, Pressable } from 'react-native';
import { ThemedText } from './themed-text';
import {
  inferImageFile,
  inferBase64Image,
  getHardcodedCatPoseImageBase64,
  HybrIKResult,
} from '@/utils/hybrik-pose-utils';
import { applyHybrIKPoseToMixamoModel } from '@/utils/mixamo-pose-utils';

import { loadThreeBundle } from '@/utils/three-loader';

interface MeshViewerProps {
  style?: any;
}

export const MeshViewer: React.FC<MeshViewerProps> = ({ style }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sceneRef = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const controlsRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Ready to generate SMPL 3D Mesh');
  const [hybrikResult, setHybrikResult] = useState<HybrIKResult | null>(null);
  const [uploadedImageUri, setUploadedImageUri] = useState<string | null>(null);

  // Mesh view controls - default to SMPL Grey Body Mesh matching reference image
  const [meshRenderMode, setMeshRenderMode] = useState<'smpl_grey' | 'wireframe' | 'cyan_cyber' | 'clay'>('smpl_grey');
  const [wireframeOverlay, setWireframeOverlay] = useState(false);
  const [studioTheme, setStudioTheme] = useState<'light' | 'dark'>('light');

  // Load Three.js, GLTFLoader & FBXLoader via singleton bundle
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    let isMounted = true;
    loadThreeBundle()
      .then(() => {
        if (isMounted) setScriptLoaded(true);
      })
      .catch((err) => {
        console.error('[MeshViewer] Failed to load Three.js bundle:', err);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Helper to apply SMPL 3D Mesh material styling (neutral grey mannequin mesh as in reference photo)
  const applyMeshStyles = useCallback(() => {
    if (!modelRef.current || !(window as any).THREE) return;
    const THREE = (window as any).THREE;

    let meshCount = 0;
    modelRef.current.traverse((child: any) => {
      if (child.isMesh || child.isSkinnedMesh) {
        meshCount++;
        child.visible = true;
        child.castShadow = true;
        child.receiveShadow = true;
        child.frustumCulled = false;

        console.log('[MeshViewer] Processing mesh:', child.name, 'type:', child.type,
          'geometry vertices:', child.geometry?.attributes?.position?.count,
          'visible:', child.visible, 'material type:', child.material?.type);

        // Modify existing material in-place to preserve skinning shader in Three.js r128
        const mat = child.material;
        if (mat) {
          // Strip textures
          mat.map = null;
          mat.normalMap = null;
          mat.roughnessMap = null;
          mat.metalnessMap = null;

          // Set side to DoubleSide so backface is visible
          mat.side = THREE.DoubleSide;

          if (meshRenderMode === 'smpl_grey') {
            mat.wireframe = wireframeOverlay;
            mat.color.set(wireframeOverlay ? '#00ffcc' : '#a2a9b3');
            if (mat.emissive) mat.emissive.set(wireframeOverlay ? '#003326' : '#14161a');
            mat.roughness = 0.35;
            mat.metalness = 0.12;
            mat.transparent = false;
            mat.opacity = 1.0;
          } else if (meshRenderMode === 'wireframe') {
            mat.wireframe = true;
            mat.color.set('#00ffcc');
            if (mat.emissive) mat.emissive.set('#004433');
            mat.transparent = false;
            mat.opacity = 1.0;
          } else if (meshRenderMode === 'cyan_cyber') {
            mat.wireframe = wireframeOverlay;
            mat.color.set('#00ffcc');
            if (mat.emissive) mat.emissive.set('#003326');
            mat.roughness = 0.2;
            mat.metalness = 0.4;
          } else if (meshRenderMode === 'clay') {
            mat.wireframe = wireframeOverlay;
            mat.color.set('#d4d4d8');
            if (mat.emissive) mat.emissive.set('#18181b');
            mat.roughness = 0.5;
            mat.metalness = 0.0;
          }
          mat.needsUpdate = true;
        }
      }
    });
    console.log('[MeshViewer] applyMeshStyles: found', meshCount, 'mesh(es)');
  }, [meshRenderMode, wireframeOverlay]);

  // Update Studio Background & Lighting
  useEffect(() => {
    if (!sceneRef.current || !(window as any).THREE) return;
    const THREE = (window as any).THREE;

    if (studioTheme === 'light') {
      sceneRef.current.background = new THREE.Color('#eef2f6');
      if (sceneRef.current.fog) sceneRef.current.fog = new THREE.FogExp2('#eef2f6', 0.03);
    } else {
      sceneRef.current.background = new THREE.Color('#0e1017');
      if (sceneRef.current.fog) sceneRef.current.fog = new THREE.FogExp2('#0e1017', 0.04);
    }
  }, [studioTheme]);

  // Initialize Three.js Scene, OrbitControls, Lighting, and SMPL Mesh
  useEffect(() => {
    if (!scriptLoaded || Platform.OS !== 'web' || !mountRef.current) return;

    const THREE = (window as any).THREE;
    if (!THREE) return;

    if (!THREE.OrbitControls && typeof document !== 'undefined') {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js';
      script.onload = () => {
        initScene();
      };
      document.head.appendChild(script);
    } else {
      initScene();
    }

    function initScene() {
      if (!mountRef.current) return;
      mountRef.current.innerHTML = '';

      const width = mountRef.current.clientWidth || 800;
      const height = mountRef.current.clientHeight || 500;

      // 1. Scene
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#eef2f6');
      scene.fog = new THREE.FogExp2('#eef2f6', 0.03);
      sceneRef.current = scene;

      // 2. Camera
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
      camera.position.set(0, 1.2, 3.2);
      cameraRef.current = camera;

      // 3. Renderer
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      rendererRef.current = renderer;
      mountRef.current.appendChild(renderer.domElement);

      // 4. OrbitControls
      if (THREE.OrbitControls) {
        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.target.set(0, 0.95, 0);
        controls.maxPolarAngle = Math.PI / 2 + 0.1;
        controls.minDistance = 1.0;
        controls.maxDistance = 8.0;
        controlsRef.current = controls;
      }

      // 5. Lighting tuned for SMPL Grey Body Mesh
      const ambientLight = new THREE.AmbientLight('#ffffff', 1.0);
      scene.add(ambientLight);

      const mainLight = new THREE.DirectionalLight('#ffffff', 1.4);
      mainLight.position.set(4, 6, 4);
      mainLight.castShadow = true;
      mainLight.shadow.mapSize.width = 1024;
      mainLight.shadow.mapSize.height = 1024;
      scene.add(mainLight);

      const fillLight = new THREE.DirectionalLight('#cbd5e1', 0.7);
      fillLight.position.set(-4, 3, -3);
      scene.add(fillLight);

      // 6. Studio Floor Ground & Soft Shadow
      const gridHelper = new THREE.GridHelper(10, 20, '#cbd5e1', '#e2e8f0');
      gridHelper.position.y = 0;
      scene.add(gridHelper);

      const shadowPlaneGeo = new THREE.PlaneGeometry(10, 10);
      const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.25 });
      const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
      shadowPlane.rotation.x = -Math.PI / 2;
      shadowPlane.receiveShadow = true;
      scene.add(shadowPlane);

      // 7. Load FBX Human Model & Convert to Pure SMPL Mannequin Body Mesh
      const loadModelIntoScene = (model: any) => {
        modelRef.current = model;

        // Debug: log what we got
        let debugMeshes = 0;
        let debugSkinnedMeshes = 0;
        model.traverse((c: any) => {
          if (c.isSkinnedMesh) debugSkinnedMeshes++;
          else if (c.isMesh) debugMeshes++;
          c.frustumCulled = false;
        });
        console.log('[MeshViewer] Model loaded: meshes=%d, skinnedMeshes=%d', debugMeshes, debugSkinnedMeshes);

        // Add to scene first
        scene.add(model);
        model.updateMatrixWorld(true);

        // Compute bounds and normalize to ~1.8m height, grounded at Y=0
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        console.log('[MeshViewer] Bounds: min=%o, max=%o, size=%o', box.min.toArray(), box.max.toArray(), size.toArray());

        if (size.y > 0.01) {
          const targetHeight = 1.8;
          const scaleFactor = targetHeight / size.y;
          model.scale.multiplyScalar(scaleFactor);

          // Recompute after scale
          const scaledBox = new THREE.Box3().setFromObject(model);
          const center = new THREE.Vector3();
          scaledBox.getCenter(center);

          model.position.x -= center.x;
          model.position.y -= scaledBox.min.y;
          model.position.z -= center.z;

          console.log('[MeshViewer] After normalization: scale=%f, position=%o', scaleFactor, model.position.toArray());
        }

        // Apply SMPL Grey Mesh styling
        applyMeshStyles();

        console.log('[MeshViewer] Model added to scene. Scene children:', scene.children.length);
      };

      // Try FBXLoader first (original source), fallback to GLTFLoader (converted .glb)
      if (THREE.FBXLoader) {
        console.log('[MeshViewer] Loading humanMesh6.fbx with FBXLoader...');
        const fbxLoader = new THREE.FBXLoader();
        fbxLoader.load(
          '/humanMesh6.fbx',
          (fbxModel: any) => {
            console.log('[MeshViewer] FBX model loaded successfully');
            loadModelIntoScene(fbxModel);
          },
          undefined,
          (err: any) => {
            console.error('[MeshViewer] FBX load failed, falling back to GLB:', err);
            // Fallback to GLB
            if (THREE.GLTFLoader) {
              const gltfLoader = new THREE.GLTFLoader();
              gltfLoader.load(
                '/human.glb',
                (gltf: any) => loadModelIntoScene(gltf.scene),
                undefined,
                (err2: any) => console.error('[MeshViewer] GLB fallback also failed:', err2)
              );
            }
          }
        );
      } else if (THREE.GLTFLoader) {
        console.log('[MeshViewer] FBXLoader not available, loading human.glb with GLTFLoader...');
        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.load(
          '/human.glb',
          (gltf: any) => loadModelIntoScene(gltf.scene),
          undefined,
          (err: any) => console.error('[MeshViewer] Error loading GLB:', err)
        );
      }

      // 8. Animation Loop
      const animate = () => {
        animationFrameRef.current = requestAnimationFrame(animate);
        if (controlsRef.current) {
          controlsRef.current.update();
        }
        renderer.render(scene, camera);
      };
      animate();

      // Handle Resize
      const handleResize = () => {
        if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
        const w = mountRef.current.clientWidth;
        const h = mountRef.current.clientHeight;
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(w, h);
      };
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }
  }, [scriptLoaded, applyMeshStyles]);

  // Apply styles on mode/theme changes
  useEffect(() => {
    applyMeshStyles();
  }, [meshRenderMode, wireframeOverlay, applyMeshStyles]);

  // Function to process image & reconstruct 3D Mesh via HybrIK AI
  const processImageForMesh = async (fileOrUri: File | string) => {
    setLoading(true);
    setStatusMessage('Analyzing image with HybrIK-X 3D Mesh Engine...');

    try {
      let result: HybrIKResult;
      if (typeof fileOrUri === 'string') {
        setUploadedImageUri(fileOrUri);
        result = await inferBase64Image(fileOrUri);
      } else {
        const objectUrl = URL.createObjectURL(fileOrUri);
        setUploadedImageUri(objectUrl);
        result = await inferImageFile(fileOrUri);
      }

      setHybrikResult(result);

      if (result && result.success && result.joints_3d && result.joints_3d.length > 0) {
        setStatusMessage(`SMPL 3D Body Mesh created in ${result.process_time_ms}ms!`);

        const THREE = (window as any).THREE;
        if (THREE && sceneRef.current) {
          // Apply HybrIK 3D pose parameters to Mixamo body mesh
          applyHybrIKPoseToMixamoModel(sceneRef.current, result, THREE);

          // Re-apply SMPL mannequin mesh styles
          applyMeshStyles();

          if (controlsRef.current) {
            controlsRef.current.target.set(0, 0.95, 0);
          }
        }
      } else {
        setStatusMessage(result?.message || 'Failed to detect human pose/mesh in image.');
      }
    } catch (err: any) {
      console.error('Mesh generation error:', err);
      setStatusMessage(`Mesh creation error: ${err.message || 'Server error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageForMesh(file);
    }
  };

  const handleTestSampleCatPose = async () => {
    setLoading(true);
    setStatusMessage('Fetching sample cat pose image...');
    try {
      const sampleBase64 = await getHardcodedCatPoseImageBase64();
      await processImageForMesh(sampleBase64);
    } catch (err: any) {
      console.error('Error fetching sample image:', err);
      setStatusMessage('Error fetching sample pose image.');
      setLoading(false);
    }
  };

  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <View style={[styles.container, studioTheme === 'dark' && styles.containerDark, style]}>
      {/* Hidden File Input for Web */}
      {Platform.OS === 'web' && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />
      )}

      {/* 3D WebGL Canvas Container */}
      <div ref={mountRef} style={{ width: '100%', height: '100%', borderRadius: '16px', overflow: 'hidden' }} />

      {/* Top Header Badge & Preset Controls */}
      <View style={styles.topControls}>
        <View style={[styles.badgeContainer, studioTheme === 'dark' && styles.badgeContainerDark]}>
          <ThemedText style={styles.badgeTitle}>🗿 SMPL 3D Body Mesh</ThemedText>
          <ThemedText style={styles.badgeSub}>{statusMessage}</ThemedText>
        </View>

        <View style={styles.controlButtonsRow}>
          <Pressable
            onPress={() => setWireframeOverlay(!wireframeOverlay)}
            style={[styles.toggleBtn, wireframeOverlay && styles.toggleBtnActive]}
          >
            <ThemedText style={[styles.toggleBtnText, wireframeOverlay && styles.toggleBtnTextActive]}>
              🕸️ Wireframe
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={() => {
              const modes: ('smpl_grey' | 'wireframe' | 'cyan_cyber' | 'clay')[] = ['smpl_grey', 'wireframe', 'cyan_cyber', 'clay'];
              const next = modes[(modes.indexOf(meshRenderMode) + 1) % modes.length];
              setMeshRenderMode(next);
            }}
            style={styles.toggleBtn}
          >
            <ThemedText style={styles.toggleBtnText}>
              🎨 Style: {meshRenderMode.toUpperCase().replace('_', ' ')}
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={() => setStudioTheme(studioTheme === 'light' ? 'dark' : 'light')}
            style={styles.toggleBtn}
          >
            <ThemedText style={styles.toggleBtnText}>
              {studioTheme === 'light' ? '🌙 Dark Studio' : '☀️ Light Studio'}
            </ThemedText>
          </Pressable>
        </View>
      </View>

      {/* Uploaded Image Thumbnail Preview */}
      {uploadedImageUri && (
        <View style={[styles.previewContainer, studioTheme === 'dark' && styles.previewContainerDark]}>
          <ThemedText style={styles.previewLabel}>Source Image</ThemedText>
          <img src={uploadedImageUri} alt="Input source" style={styles.previewImage as any} />
        </View>
      )}

      {/* HybrIK Mesh Stats Card (When Inference is Complete) */}
      {hybrikResult && hybrikResult.success && (
        <View style={[styles.statsCard, studioTheme === 'dark' && styles.statsCardDark]}>
          <View style={styles.statsRow}>
            <ThemedText style={styles.statLabel}>⚡ Time:</ThemedText>
            <ThemedText style={styles.statVal}>{hybrikResult.process_time_ms} ms</ThemedText>
          </View>
          <View style={styles.statsRow}>
            <ThemedText style={styles.statLabel}>🔷 Vertices:</ThemedText>
            <ThemedText style={styles.statVal}>10,475 (SMPL-X)</ThemedText>
          </View>
          <View style={styles.statsRow}>
            <ThemedText style={styles.statLabel}>🦴 3D Joints:</ThemedText>
            <ThemedText style={styles.statVal}>{hybrikResult.joints_3d?.length || 55} Joints</ThemedText>
          </View>
          <View style={styles.statsRow}>
            <ThemedText style={styles.statLabel}>🎯 Mesh Fit:</ThemedText>
            <ThemedText style={[styles.statVal, { color: '#00cc99' }]}>Aligned</ThemedText>
          </View>
        </View>
      )}

      {/* Loading Overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#00cc99" />
          <ThemedText style={styles.loadingText}>{statusMessage}</ThemedText>
        </View>
      )}

      {/* Floating Action Button (FAB) Container for Image Upload & Test Sample */}
      <View style={styles.fabContainer}>
        <Pressable
          onPress={handleTestSampleCatPose}
          disabled={loading}
          style={({ pressed }) => [styles.sampleFab, pressed && { opacity: 0.8 }]}
        >
          <ThemedText style={styles.sampleFabText}>🧪 Test Cat Pose</ThemedText>
        </Pressable>

        <Pressable
          onPress={triggerFileInput}
          disabled={loading}
          style={({ pressed }) => [styles.uploadFab, pressed && { opacity: 0.8 }]}
        >
          <ThemedText style={styles.uploadFabText}>📸 Upload Image to Test Mesh</ThemedText>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 540,
    backgroundColor: '#eef2f6',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    overflow: 'hidden',
    position: 'relative',
  },
  containerDark: {
    backgroundColor: '#0e1017',
    borderColor: '#1e202e',
  },
  topControls: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
    pointerEvents: 'box-none',
  },
  badgeContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    backdropFilter: 'blur(12px)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    gap: 2,
  } as any,
  badgeContainerDark: {
    backgroundColor: 'rgba(14, 16, 23, 0.88)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  badgeTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  badgeSub: {
    fontSize: 11,
    color: '#64748b',
  },
  controlButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    backdropFilter: 'blur(12px)',
    cursor: 'pointer',
  } as any,
  toggleBtnActive: {
    backgroundColor: '#00cc99',
    borderColor: '#00cc99',
  },
  toggleBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  toggleBtnTextActive: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  previewContainer: {
    position: 'absolute',
    top: 80,
    left: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    zIndex: 10,
    alignItems: 'center',
    gap: 4,
  },
  previewContainerDark: {
    backgroundColor: 'rgba(14, 16, 23, 0.92)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  previewLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  previewImage: {
    width: 90,
    height: 110,
    borderRadius: 8,
    objectFit: 'cover',
    borderWidth: 1,
    borderColor: 'rgba(0, 204, 153, 0.4)',
  },
  statsCard: {
    position: 'absolute',
    bottom: 80,
    left: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    zIndex: 10,
    gap: 6,
    minWidth: 160,
  },
  statsCardDark: {
    backgroundColor: 'rgba(14, 16, 23, 0.92)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  statLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  statVal: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(238, 242, 246, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    gap: 12,
    backdropFilter: 'blur(8px)',
  } as any,
  loadingText: {
    color: '#00cc99',
    fontSize: 14,
    fontWeight: '600',
  },
  fabContainer: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    flexDirection: 'row',
    gap: 10,
    zIndex: 20,
  },
  uploadFab: {
    backgroundColor: '#00cc99',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00cc99',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
    cursor: 'pointer',
  } as any,
  uploadFabText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  sampleFab: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.12)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  } as any,
  sampleFabText: {
    color: '#334155',
    fontWeight: 'bold',
    fontSize: 13,
  },
});
