import { useState, useRef } from 'react';
import { Platform } from 'react-native';
import { getBackwardFootX } from '@/utils/model-pose-solver';

export function parseAnimationFromUrl(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.location) {
    return null;
  }

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const paramNames = ['animation', 'sequence', 'anim', 'json', 'data', 'poses'];

    for (const name of paramNames) {
      const val = searchParams.get(name);
      if (val) {
        try {
          const parsed = JSON.parse(decodeURIComponent(val));
          if (Array.isArray(parsed) && parsed.length > 0) {
            return JSON.stringify(parsed, null, 2);
          }
        } catch (e) {
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed) && parsed.length > 0) {
              return JSON.stringify(parsed, null, 2);
            }
          } catch (e2) {}
        }
      }
    }

    for (const [_, val] of searchParams.entries()) {
      if (val) {
        const trimmed = val.trim();
        if (trimmed.startsWith('[') || trimmed.startsWith('%5B')) {
          try {
            const decoded = decodeURIComponent(val);
            const parsed = JSON.parse(decoded);
            if (Array.isArray(parsed) && parsed.length > 0) {
              return JSON.stringify(parsed, null, 2);
            }
          } catch (e) {}
        }
      }
    }

    if (window.location.hash) {
      const hashStr = window.location.hash.slice(1);
      const hashParams = new URLSearchParams(hashStr);
      for (const name of paramNames) {
        const val = hashParams.get(name);
        if (val) {
          try {
            const parsed = JSON.parse(decodeURIComponent(val));
            if (Array.isArray(parsed) && parsed.length > 0) {
              return JSON.stringify(parsed, null, 2);
            }
          } catch (e) {
            try {
              const parsed = JSON.parse(val);
              if (Array.isArray(parsed) && parsed.length > 0) {
                return JSON.stringify(parsed, null, 2);
              }
            } catch (e2) {}
          }
        }
      }
    }
  } catch (e) {
    console.warn('Failed to parse URL search params:', e);
  }

  return null;
}

export function useAnimationPlayer(
  viewerRef: any,
  poses: any[],
  setIkLegsEnabled: (val: boolean) => void,
  ikLegsEnabledRef: React.MutableRefObject<boolean>,
  setIkArmsEnabled: (val: boolean) => void,
  ikArmsEnabledRef: React.MutableRefObject<boolean>,
  updateModelPoseCb: (scene: any, THREE: any, refFootX?: number | null | 'center') => void,
  updateBoneRotationCb: () => void
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [promptText, setPromptText] = useState('');
  const [jsonText, setJsonText] = useState<string>(() => {
    const urlAnim = parseAnimationFromUrl();
    if (urlAnim) return urlAnim;
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem('vyom_animation_sequence');
      if (saved) return saved;
    }
    return '';
  });

  const stopAnimation = () => {
    isPlayingRef.current = false;
    setIsPlaying(false);
  };

  const transitionToPose = (
    targetPose: any,
    transitionDuration: number,
    refFootX?: number | null | 'center'
  ): Promise<number | null> => {
    return new Promise((resolve) => {
      const viewer = viewerRef.current;
      if (!viewer || !targetPose || !targetPose.skeleton) {
        resolve(null);
        return;
      }

      const symbols = Object.getOwnPropertySymbols(viewer);
      const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
      if (!sceneSym) {
        resolve(null);
        return;
      }

      const scene = viewer[sceneSym];
      if (!scene) {
        resolve(null);
        return;
      }

      const THREE = (window as any).THREE;
      if (!THREE) {
        resolve(null);
        return;
      }

      const targetRefFootX = refFootX !== undefined ? refFootX : getBackwardFootX(scene, THREE);

      const boneMap = new Map<string, any>();
      scene.traverse((child: any) => {
        if (child.isBone) {
          boneMap.set(child.name, child);
        }
      });

      const ikGlobal = targetPose.skeleton.find((b: any) => b.name === '__ik_global__');
      if (ikGlobal) {
        const legs = !!ikGlobal.ikLegsEnabled;
        const arms = !!ikGlobal.ikArmsEnabled;
        setIkLegsEnabled(legs);
        ikLegsEnabledRef.current = legs;
        setIkArmsEnabled(arms);
        ikArmsEnabledRef.current = arms;
      }

      const startStates = new Map<string, { quat: any; pos: any }>();
      boneMap.forEach((bone, name) => {
        startStates.set(name, {
          quat: bone.quaternion.clone(),
          pos: bone.position.clone(),
        });
      });

      const targetStates = new Map<string, { quat: any; pos: any; lockToFloor: boolean }>();
      targetPose.skeleton.forEach((savedBone: any) => {
        if (savedBone.name === '__ik_global__') return;
        const targetQuat = savedBone.rotation
          ? new THREE.Quaternion().setFromEuler(new THREE.Euler(savedBone.rotation.x, savedBone.rotation.y, savedBone.rotation.z))
          : null;
        const targetPos = savedBone.position
          ? new THREE.Vector3(savedBone.position.x, savedBone.position.y, savedBone.position.z)
          : null;
        targetStates.set(savedBone.name, {
          quat: targetQuat,
          pos: targetPos,
          lockToFloor: !!savedBone.lockToFloor,
        });
      });

      // Immediately apply lockToFloor flags from target pose at start of transition
      boneMap.forEach((bone, name) => {
        const target = targetStates.get(name);
        bone.userData.lockToFloor = target ? target.lockToFloor : false;
      });

      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const t = transitionDuration <= 0 ? 1 : Math.min(elapsed / transitionDuration, 1);

        boneMap.forEach((bone, name) => {
          const start = startStates.get(name);
          const target = targetStates.get(name);
          if (start && target) {
            if (target.quat) {
              bone.quaternion.slerpQuaternions(start.quat, target.quat, t);
            }
            if (target.pos) {
              bone.position.lerpVectors(start.pos, target.pos, t);
            }
          }
        });

        updateModelPoseCb(scene, THREE, targetRefFootX);
        if (typeof viewer.queueRender === 'function') {
          viewer.queueRender();
        }

        if (t < 1 && isPlayingRef.current) {
          requestAnimationFrame(animate);
        } else {
          updateBoneRotationCb();
          const finalFootX = getBackwardFootX(scene, THREE);
          resolve(finalFootX);
        }
      };

      requestAnimationFrame(animate);
    });
  };

  const playAnimationLoop = async (customJson?: string | any[]) => {
    let items: any[];
    const sourceJson = customJson || jsonText;

    if (typeof sourceJson === 'string') {
      try {
        items = JSON.parse(sourceJson);
        if (!Array.isArray(items)) {
          alert('JSON must be an array of objects.');
          return;
        }
      } catch (e: any) {
        alert('Invalid JSON: ' + e.message);
        return;
      }
    } else if (Array.isArray(sourceJson)) {
      items = sourceJson;
    } else {
      return;
    }

    setIsPlaying(true);
    isPlayingRef.current = true;

    let currentRefFootX: number | null = null;
    const viewer = viewerRef.current;
    if (viewer) {
      const THREE = (window as any).THREE;
      const symbols = Object.getOwnPropertySymbols(viewer);
      const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
      if (sceneSym && viewer[sceneSym] && THREE) {
        currentRefFootX = getBackwardFootX(viewer[sceneSym], THREE);
      }
    }

    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    try {
      let isFirstItem = true;
      for (const item of items) {
        if (!isPlayingRef.current) break;

        const poseName = item.name || item.pose;
        const duration = typeof item.duration === 'number' ? item.duration : 2000;
        const transitionDuration = typeof item.transitionDuration === 'number' ? item.transitionDuration : 1000;

        if (!poseName) continue;

        const targetNorm = normalize(poseName);
        const foundPose = poses.find(
          (p) => normalize(p.name || '') === targetNorm
        );

        if (!foundPose) {
          console.warn(`Pose not found: ${poseName}`);
          continue;
        }

        // For the first animation, center body on mat. For subsequent animations, use foot continuity.
        const refParam = isFirstItem ? 'center' : currentRefFootX;
        const newFootX = await transitionToPose(foundPose, transitionDuration, refParam);
        if (newFootX !== null) {
          currentRefFootX = newFootX;
        }
        isFirstItem = false;

        if (!isPlayingRef.current) break;

        // Hold the target pose for the item duration
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => resolve(), duration);
          const checkStop = setInterval(() => {
            if (!isPlayingRef.current) {
              clearTimeout(timeout);
              clearInterval(checkStop);
              resolve();
            }
          }, 100);
        });
      }
    } catch (err) {
      console.error('Error in animation playback:', err);
    } finally {
      setIsPlaying(false);
      isPlayingRef.current = false;
    }
  };

  return {
    isPlaying,
    isPlayingRef,
    promptText,
    setPromptText,
    jsonText,
    setJsonText,
    playAnimationLoop,
    stopAnimation,
    transitionToPose,
  };
}

