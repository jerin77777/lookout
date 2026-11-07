import React, { useEffect, useState, useRef } from "react";
import { View, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { ThemedText } from "./themed-text";

import { loadThreeBundle } from "@/utils/three-loader";
import { fetchAndCacheAsset } from "@/utils/asset-cache";
import { parseAnimationFromUrl } from "@/hooks/use-animation-player";

interface ModelViewerProps {
  src: string;
  showSkeleton?: boolean;
  roomTheme?: "dark" | "white";
  style?: any;
  lockCamera?: boolean;
  [key: string]: any;
}

export const ModelViewer = React.forwardRef<any, ModelViewerProps>(
  ({ src, showSkeleton = false, roomTheme = "dark", style, lockCamera, ...props }, ref) => {
    const hasUrlAnimation = React.useMemo(() => {
      return !!parseAnimationFromUrl();
    }, []);

    const isCameraLocked = lockCamera !== undefined ? lockCamera : hasUrlAnimation;

    const [scriptLoaded, setScriptLoaded] = useState(false);
    const [progress, setProgress] = useState(0); // 0 to 100
    const [modelLoaded, setModelLoaded] = useState(false);
    const [loadError, setLoadError] = useState(false);

    const mountRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<any>(null);
    const rendererRef = useRef<any>(null);
    const cameraRef = useRef<any>(null);
    const controlsRef = useRef<any>(null);
    const animationFrameRef = useRef<number | null>(null);

    // Expose Symbol('scene') and queueRender to remain compatible with SkeletonViewer and BoneTreeView
    React.useImperativeHandle(ref, () => {
      const obj = {};
      const sym = Symbol("scene");
      Object.defineProperty(obj, sym, {
        value: sceneRef.current,
        enumerable: false,
        configurable: true,
      });
      (obj as any).queueRender = () => {
        // Automatically updated by animation loop
      };
      return obj;
    });

    // Load Three.js, GLTFLoader & DRACOLoader via singleton bundle loader
    useEffect(() => {
      if (Platform.OS !== "web") return;

      let isMounted = true;
      loadThreeBundle()
        .then(() => {
          if (isMounted) setScriptLoaded(true);
        })
        .catch((err) => {
          console.error("Failed to load Three.js bundle:", err);
          if (isMounted) setLoadError(true);
        });

      return () => {
        isMounted = false;
      };
    }, []);

    // Setup Custom Three.js Scene and Renderer
    useEffect(() => {
      if (!scriptLoaded || Platform.OS !== "web" || !mountRef.current) return;

      const THREE = (window as any).THREE;
      if (!THREE) return;

      const mount = mountRef.current;
      const rect = mount.getBoundingClientRect();
      const w = rect.width || 400;
      const h = rect.height || 550;

      // 1. Scene
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(
        roomTheme === "white" ? 0xf8f8f8 : 0x050505,
      );
      sceneRef.current = scene;

      // 2. Renderer
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
      });
      renderer.setSize(w, h);
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      // Tone mapping & encoding for brighter, more natural rendering
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.3;
      renderer.outputEncoding = THREE.sRGBEncoding;

      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      mount.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // 3. Camera
      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
      camera.position.set(0, 0.8, 4);
      cameraRef.current = camera;

      // 4. Controls
      const controls = createOrbitControls(THREE, camera, renderer.domElement);
      controls.target.set(0, 1.0, 0);
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enabled = !isCameraLocked;
      controls.enableRotate = !isCameraLocked;
      controlsRef.current = controls;

      // 5. Lighting
      const ambientLight = new THREE.AmbientLight(
        0xffffff,
        roomTheme === "white" ? 0.45 : 0.2,
      );
      scene.add(ambientLight);

    
      // Sunlight (directional light that casts window mullion shadows)
      const dirLight = new THREE.DirectionalLight(
        0xfffaed,
        roomTheme === "white" ? 0.9 : 0.3,
      );
      dirLight.position.set(-5, 4,  3);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.width = 2048;
      dirLight.shadow.mapSize.height = 2048;
      dirLight.shadow.camera.near = 0.5;
      dirLight.shadow.camera.far = 15;
      const d = 8;
      dirLight.shadow.camera.left = -d;
      dirLight.shadow.camera.right = d;
      dirLight.shadow.camera.top = d;
      dirLight.shadow.camera.bottom = -d;
      dirLight.shadow.bias = -0.0002;
      scene.add(dirLight);
      scene.add(dirLight.target);

      // Front-right light to illuminate the character's front and the room details
      const frontLight = new THREE.DirectionalLight(
        0xffffff,
        roomTheme === "white" ? 0.6 : 0.2,
      );
      frontLight.position.set(3, 3, 5);
      scene.add(frontLight);

      // Backlight to make character pop
      const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
      backLight.position.set(3, 3, -5);
      scene.add(backLight);

      // 6. Yoga Room Group
      const roomGroup = new THREE.Group();
      roomGroup.name = "yoga-room-group";

      if (roomTheme === "white") {
        const wallMat = new THREE.MeshStandardMaterial({
          color: 0xffffff, // Pure white walls
          roughness: 0.9,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });

        const floorMat = new THREE.MeshStandardMaterial({
          color: 0xfafafa, // Clean off-white floor
          roughness: 0.8,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });

        const matMat = new THREE.MeshStandardMaterial({
          color: 0x222222,
          roughness: 0.9,
          side: THREE.DoubleSide,
        });

        // Floor
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 14), floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = 0;
        floor.receiveShadow = true;
        roomGroup.add(floor);

        // Ceiling
        const ceiling = new THREE.Mesh(
          new THREE.PlaneGeometry(10, 14),
          wallMat,
        );
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.y = 10;
        ceiling.receiveShadow = true;
        roomGroup.add(ceiling);

        // Yoga Mat
        const yogaMat = new THREE.Mesh(
          new THREE.PlaneGeometry(2.6, 1.2),
          matMat,
        );
        yogaMat.name = "yoga-mat";
        yogaMat.rotation.x = -Math.PI / 2;
        yogaMat.position.set(0, 0.003, 0);
        yogaMat.receiveShadow = true;
        roomGroup.add(yogaMat);

        // Back Wall
        const backWall = new THREE.Mesh(
          new THREE.PlaneGeometry(10, 10),
          wallMat,
        );
        backWall.position.set(0, 5, -5);
        backWall.receiveShadow = true;
        backWall.castShadow = true;
        roomGroup.add(backWall);

        // Front Wall
        const frontWall = new THREE.Mesh(
          new THREE.PlaneGeometry(10, 10),
          wallMat,
        );
        frontWall.rotation.y = Math.PI;
        frontWall.position.set(0, 5, 5);
        frontWall.receiveShadow = true;
        frontWall.castShadow = true;
        roomGroup.add(frontWall);

        // Right Wall
        // const rightWall = new THREE.Mesh(
        //   new THREE.PlaneGeometry(10, 10),
        //   wallMat,
        // );
        // rightWall.rotation.y = -Math.PI / 2;
        // rightWall.position.set(3, 5, 0);
        // rightWall.receiveShadow = true;
        // rightWall.castShadow = true;
        // roomGroup.add(rightWall);

        // Left Wall with 10×4 window cutout
        // The window height is 4, centered vertically from y = 1 to 5.
        // This leaves a 1m wall segment at the bottom (y: 0 -> 1) and a 5m segment at the top (y: 5 -> 10).
        const wallThickness = 0.6;
        const wallX = -3.0 - wallThickness / 2; // -3.3

        const wallBottom = new THREE.Mesh(
          new THREE.BoxGeometry(wallThickness, 1, 10),
          wallMat,
        );
        wallBottom.position.set(wallX, 0.5, 0);
        wallBottom.receiveShadow = true;
        wallBottom.castShadow = true;
        roomGroup.add(wallBottom);

        const wallTop = new THREE.Mesh(
          new THREE.BoxGeometry(wallThickness, 5, 10),
          wallMat,
        );
        wallTop.position.set(wallX, 7.5, 0);
        wallTop.receiveShadow = true;
        wallTop.castShadow = true;
        roomGroup.add(wallTop);

        // Solid sections of the left wall to frame the windows
        // Back extension: spans from z = -5 to z = -4.4 (width 0.6, height 4, centered at z = -4.7, y = 3)
        const wallBackExtension = new THREE.Mesh(
          new THREE.BoxGeometry(wallThickness, 4, 0.6),
          wallMat,
        );
        wallBackExtension.position.set(wallX, 3, -4.7);
        wallBackExtension.receiveShadow = true;
        wallBackExtension.castShadow = true;
        roomGroup.add(wallBackExtension);

        // Front extension: spans from z = -0.4 to z = 5 (width 5.4, height 4, centered at z = 2.3, y = 3)
        const wallFrontExtension = new THREE.Mesh(
          new THREE.BoxGeometry(wallThickness, 4, 5.4),
          wallMat,
        );
        wallFrontExtension.position.set(wallX, 3, 2.3);
        wallFrontExtension.receiveShadow = true;
        wallFrontExtension.castShadow = true;
        roomGroup.add(wallFrontExtension);

        // Load glass window GLTF model and replicate it into a 4x4 grid of 2x2 windows (2 columns, 2 rows)
        if (THREE.GLTFLoader) {
          const loader = new THREE.GLTFLoader();
          loader.load(
            "/glass_window/scene.gltf",
            (gltf: any) => {
              try {
                const windowModel = gltf.scene;
                const box = new THREE.Box3().setFromObject(windowModel);
                const center = new THREE.Vector3();
                box.getCenter(center);
                const size = new THREE.Vector3();
                box.getSize(size);

                windowModel.position.sub(center);

                // Create a single 2x2 window template
                const singleWindow = new THREE.Group();
                singleWindow.add(windowModel);

                // The window model in assets is already oriented in the Y-Z plane (width along Z, height along Y, thickness along X).
                // We scale it so it is 2x2: width size.z -> 2.0, height size.y -> 2.0, thickness is proportional.
                const scaleX = 2.0 / size.z;
                const scaleY = 2.0 / size.y;
                const scaleZ = 2.0 / size.z;
                singleWindow.scale.set(scaleX, scaleY, scaleZ);

                singleWindow.traverse((child: any) => {
                  if (child.isMesh && child.material) {
                    const oldMat = child.material;
                    const isGlass =
                      (oldMat.name &&
                        oldMat.name.toLowerCase().includes("064")) ||
                      (oldMat.transmission && oldMat.transmission > 0) ||
                      oldMat.alphaMode === "BLEND";

                    if (isGlass) {
                      child.material = new THREE.MeshPhysicalMaterial({
                        color: 0xd4e8f0,
                        transparent: true,
                        opacity: 0.15,
                        roughness: 0.1,
                        transmission: 0.9,
                        depthWrite: false,
                      });
                      child.castShadow = false;
                      child.receiveShadow = false;
                    } else {
                      const color =
                        oldMat.color && typeof oldMat.color.clone === "function"
                          ? oldMat.color.clone()
                          : new THREE.Color(0xcccccc);
                      child.material = new THREE.MeshStandardMaterial({
                        color,
                        roughness: 0.4,
                        metalness: 0.2,
                        side: THREE.DoubleSide,
                      });
                      child.castShadow = true;
                      child.receiveShadow = true;
                    }
                  }
                });

                 // Instantiate the 4 window units (2 columns, 2 rows) to fill the cutout
                 // Columns: Z = -3.4, -1.4 (leaving z = -5 to -4.4, and z = -0.4 to 5 as solid walls)
                 // Rows: Y = 2, 4
                 const yCoords = [2.0, 4.0];
                 const zCoords = [-3.4, -1.4];

                yCoords.forEach((yVal) => {
                  zCoords.forEach((zVal) => {
                    const windowInst = singleWindow.clone();
                    windowInst.position.set(wallX, yVal, zVal);
                    roomGroup.add(windowInst);
                  });
                });
              } catch (err) {
                console.error("Error processing glass window model:", err);
              }
            },
            undefined,
            (err: any) => {
              console.error("Error loading glass window GLTF:", err);
            },
          );
        }
      }
      scene.add(roomGroup);

      // 7. Load Amber glb character model with persistent IndexedDB & CacheStorage cache
      if (THREE.GLTFLoader) {
        const loader = new THREE.GLTFLoader();
        if (THREE.DRACOLoader) {
          const dracoLoader = new THREE.DRACOLoader();
          dracoLoader.setDecoderPath("/draco/");
          loader.setDRACOLoader(dracoLoader);
        }
        let isCancelled = false;

        const loadModelWithCache = async () => {
          try {
            const buffer = await fetchAndCacheAsset(src, (percent) => {
              if (!isCancelled) setProgress(percent);
            });

            if (isCancelled || !buffer) return;

            // Parse GLB ArrayBuffer with GLTFLoader
            loader.parse(
              buffer,
              "",
              (gltf: any) => {
                if (isCancelled) return;
                const model = gltf.scene;
                scene.add(model);

                model.traverse((child: any) => {
                  if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                  }
                });

                setModelLoaded(true);
                setProgress(100);
                console.log(`[3D Cache] Successfully initialized 3D model.`);
              },
              (err: any) => {
                console.error("[3D Cache] Error parsing GLTF model:", err);
                if (!isCancelled) setLoadError(true);
              },
            );
          } catch (err: any) {
            console.error("[3D Cache] Failed to load model:", err);
            if (!isCancelled) {
              setLoadError(true);
            }
          }
        };

        loadModelWithCache();
      }

      // 8. Animation/Render Loop
      const animate = () => {
        animationFrameRef.current = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      // 9. Resize Handler
      const handleResize = () => {
        const rect = mount.getBoundingClientRect();
        camera.aspect = rect.width / rect.height;
        camera.updateProjectionMatrix();
        renderer.setSize(rect.width, rect.height);
      };
      window.addEventListener("resize", handleResize);

      // 10. Cleanup on unmount
      return () => {
        window.removeEventListener("resize", handleResize);
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        controls.dispose();

        scene.traverse((obj: any) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m: any) => m.dispose());
            } else {
              obj.material.dispose();
            }
          }
        });

        renderer.dispose();
        if (mount.contains(renderer.domElement)) {
          mount.removeChild(renderer.domElement);
        }
      };
    }, [scriptLoaded, roomTheme, src]);

    // Keep camera controls lock status in sync if prop or URL param state changes
    useEffect(() => {
      if (controlsRef.current) {
        controlsRef.current.enabled = !isCameraLocked;
        controlsRef.current.enableRotate = !isCameraLocked;
      }
    }, [isCameraLocked]);

    if (Platform.OS !== "web") {
      return (
        <View style={[styles.container, styles.fallbackContainer, style]}>
          <ThemedText type="smallBold">3D Preview (Web Only)</ThemedText>
        </View>
      );
    }

    if (loadError) {
      return (
        <View style={[styles.container, styles.fallbackContainer, style]}>
          <ThemedText style={{ color: "#ff4d4f", textAlign: "center" }}>
            Failed to load 3D viewer or model.
          </ThemedText>
          <ThemedText
            type="small"
            style={{ color: "#888", marginTop: 8, textAlign: "center" }}
          >
            Ensure the asset exists at `/amber.glb` and your connection is
            active.
          </ThemedText>
        </View>
      );
    }

    return (
      <View style={[styles.container, roomTheme === "white" && { backgroundColor: "#ffffff" }, style]}>
        {(!scriptLoaded || !modelLoaded) && (
          <View style={[styles.loadingContainer, roomTheme === "white" && { backgroundColor: "#ffffff" }]}>
            <ActivityIndicator size="large" color="#208AEF" />
            <ThemedText type="smallBold" style={[styles.loadingTitle, roomTheme === "white" && { color: "#333" }]}>
              {!scriptLoaded
                ? "Initializing 3D Engine..."
                : "Loading 3D Model..."}
            </ThemedText>
            {scriptLoaded && (
              <View style={styles.progressWrapper}>
                <View style={styles.progressBarBg}>
                  <View
                    style={[styles.progressBarFill, { width: `${progress}%` }]}
                  />
                </View>
                <ThemedText type="small" style={[styles.progressText, roomTheme === "white" && { color: "#666" }]}>
                  {progress}%
                </ThemedText>
              </View>
            )}
          </View>
        )}
        <div
          ref={mountRef}
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: roomTheme === "white" ? "#ffffff" : "#050505",
            backgroundImage:
              roomTheme === "white"
                ? "linear-gradient(rgba(0, 0, 0, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 0, 0, 0.03) 1px, transparent 1px)"
                : "none",
            backgroundSize: "20px 20px",
            backgroundPosition: "center",
          }}
        />
      </View>
    );
  },
);

/* ─── Minimal OrbitControls implementation ─── */
function createOrbitControls(THREE: any, camera: any, domElement: HTMLElement) {
  const scope: any = {
    enabled: true,
    target: new THREE.Vector3(),
    enableDamping: false,
    dampingFactor: 0.05,
    enableRotate: true,
    rotateSpeed: 1.0,
    enableZoom: false,
    zoomSpeed: 1.0,
    enablePan: false,
  };

  let spherical = new THREE.Spherical();
  let sphericalDelta = new THREE.Spherical();
  let scale = 1;
  let rotateStart = new THREE.Vector2();
  let rotateEnd = new THREE.Vector2();
  let rotateDelta = new THREE.Vector2();
  let isPointerDown = false;

  const EPS = 0.000001;
  const twoPI = 2 * Math.PI;

  scope.update = (function () {
    const offset = new THREE.Vector3();
    const quat = new THREE.Quaternion().setFromUnitVectors(
      camera.up,
      new THREE.Vector3(0, 1, 0),
    );
    const quatInverse = quat.clone().invert();

    const lastPosition = new THREE.Vector3();
    const lastQuaternion = new THREE.Quaternion();

    return function () {
      const position = camera.position;
      offset.copy(position).sub(scope.target);
      offset.applyQuaternion(quat);

      spherical.setFromVector3(offset);

      spherical.theta += sphericalDelta.theta;
      spherical.phi += sphericalDelta.phi;

      // Clamp phi (polar angle) to avoid flipping
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
      spherical.radius *= scale;
      spherical.radius = Math.max(0.1, Math.min(50, spherical.radius));

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
  })();

  function onPointerDown(event: PointerEvent) {
    if (!scope.enabled || !scope.enableRotate) return;
    isPointerDown = true;
    if (event.button === 0 || event.pointerType === "touch") {
      rotateStart.set(event.clientX, event.clientY);
    }
    domElement.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!scope.enabled || !isPointerDown || !scope.enableRotate) return;

    rotateEnd.set(event.clientX, event.clientY);
    rotateDelta
      .subVectors(rotateEnd, rotateStart)
      .multiplyScalar(scope.rotateSpeed);

    const rect = domElement.getBoundingClientRect();
    sphericalDelta.theta -= (twoPI * rotateDelta.x) / rect.height;
    sphericalDelta.phi -= (twoPI * rotateDelta.y) / rect.height;

    rotateStart.copy(rotateEnd);
  }

  function onPointerUp(event: PointerEvent) {
    isPointerDown = false;
    domElement.releasePointerCapture(event.pointerId);
  }

  domElement.addEventListener("pointerdown", onPointerDown);
  domElement.addEventListener("pointermove", onPointerMove);
  domElement.addEventListener("pointerup", onPointerUp);

  scope.dispose = function () {
    domElement.removeEventListener("pointerdown", onPointerDown);
    domElement.removeEventListener("pointermove", onPointerMove);
    domElement.removeEventListener("pointerup", onPointerUp);
  };

  return scope;
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: 550,
    backgroundColor: "#050505",
    borderRadius: 24,
    overflow: "hidden",
    position: "relative",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  loadingContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
    padding: 24,
  },
  loadingTitle: {
    marginTop: 16,
    color: "#fff",
    fontSize: 16,
  },
  progressWrapper: {
    width: "80%",
    maxWidth: 300,
    marginTop: 16,
    alignItems: "center",
  },
  progressBarBg: {
    width: "100%",
    height: 6,
    backgroundColor: "#222",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#208AEF",
    borderRadius: 3,
  },
  progressText: {
    marginTop: 8,
    color: "#888",
    fontSize: 12,
  },
  fallbackContainer: {
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
});
