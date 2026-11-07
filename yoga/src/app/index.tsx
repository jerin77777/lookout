import { Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useRef, useEffect, useCallback } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ModelViewer } from '@/components/model-viewer';
import { SkeletonViewer } from '@/components/skeleton-viewer';
import { BoneTreeView } from '@/components/bone-tree-view';
import { api } from '@/services/api';

import { HeaderNavigation } from '@/components/header-navigation';
import { PoseSidebar } from '@/components/pose-sidebar';
import { AnimationSidebar } from '@/components/animation-sidebar';
import { AnimationControls } from '@/components/animation-controls';
import { BoneDetailsPanel } from '@/components/bone-details-panel';
import { CleanHierarchyRotationPanel } from '@/components/clean-hierarchy-rotation-panel';
import { PoseFabContainer } from '@/components/pose-fab-container';
import { MeditationModule } from '@/components/meditation-module';
import { MeshViewer } from '@/components/mesh-viewer';
import { DetectingPoseModal } from '@/components/detecting-pose-modal';

import { styles } from '@/app/index.styles';
import { updateModelPose, enforceSymmetry } from '@/utils/model-pose-solver';
import { useClipboardCoords } from '@/hooks/use-clipboard-coords';
import { usePosesManager } from '@/hooks/use-poses-manager';
import { useAnimationPlayer, parseAnimationFromUrl } from '@/hooks/use-animation-player';
import {
  getCounterpartBoneName,
  isArmBone,
  isLegBone,
} from '@/utils/pose-utils';
import { inferBase64Image, applyHybrIKPoseToModel } from '@/utils/hybrik-pose-utils';
import { loadThreeBundle } from '@/utils/three-loader';

export default function HomeScreen() {
  const leftViewerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedBoneName, setSelectedBoneName] = React.useState<string | null>(null);
  const [boneRotation, setBoneRotation] = React.useState({ x: 0, y: 0, z: 0 });
  const [selectedBoneLocked, setSelectedBoneLocked] = React.useState(false);
  const [headerHovered, setHeaderHovered] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<'poses' | 'animation' | 'mesh' | 'meditation'>('poses');
  const [detectingPose, setDetectingPose] = React.useState(false);

  // IK and Symmetry controls state + sync refs
  const [ikLegsEnabled, setIkLegsEnabled] = React.useState(false);
  const [ikArmsEnabled, setIkArmsEnabled] = React.useState(false);
  const [symmetricArmsEnabled, setSymmetricArmsEnabled] = React.useState(false);
  const [symmetricLegsEnabled, setSymmetricLegsEnabled] = React.useState(false);

  const ikLegsEnabledRef = useRef(ikLegsEnabled);
  const ikArmsEnabledRef = useRef(ikArmsEnabled);
  const symmetricArmsEnabledRef = useRef(symmetricArmsEnabled);
  const symmetricLegsEnabledRef = useRef(symmetricLegsEnabled);

  useEffect(() => {
    ikLegsEnabledRef.current = ikLegsEnabled;
  }, [ikLegsEnabled]);

  useEffect(() => {
    ikArmsEnabledRef.current = ikArmsEnabled;
  }, [ikArmsEnabled]);

  useEffect(() => {
    symmetricArmsEnabledRef.current = symmetricArmsEnabled;
  }, [symmetricArmsEnabled]);

  useEffect(() => {
    symmetricLegsEnabledRef.current = symmetricLegsEnabled;
  }, [symmetricLegsEnabled]);

  // Model pose update solver callback wrapper
  const updateModelPoseCb = useCallback((scene: any, THREE: any, refFootX?: number | null | 'center') => {
    updateModelPose(
      scene,
      THREE,
      ikLegsEnabledRef.current,
      ikArmsEnabledRef.current,
      symmetricArmsEnabledRef.current,
      symmetricLegsEnabledRef.current,
      refFootX
    );
  }, []);

  // Custom hooks for sub-domain state & features
  const { clipboardCoords, copyCoords, pasteCoords } = useClipboardCoords(selectedBoneName);

  const {
    poses,
    setPoses,
    loadingPoses,
    selectedPoseId,
    setSelectedPoseId,
    showAddDialog,
    setShowAddDialog,
    newPoseName,
    setNewPoseName,
    addingPose,
    lastDetectedPoses,
    setLastDetectedPoses,
    defaultPoseRef,
    fetchPoses,
    getCurrentSkeletonBones,
    triggerAutoSave,
    handleAddPose,
    handleDeletePose,
  } = usePosesManager(
    leftViewerRef,
    ikLegsEnabledRef,
    ikArmsEnabledRef,
    symmetricArmsEnabledRef,
    symmetricLegsEnabledRef
  );

  const updateSelectedBoneLockFromScene = useCallback(() => {
    if (!selectedBoneName) return;
    const viewer = leftViewerRef.current;
    if (!viewer) return;
    const symbols = Object.getOwnPropertySymbols(viewer);
    const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
    if (!sceneSym) return;
    const scene = viewer[sceneSym];
    if (!scene) return;

    scene.traverse((child: any) => {
      if (child.isBone && child.name === selectedBoneName) {
        setSelectedBoneLocked(!!child.userData.lockToFloor);
      }
    });
  }, [selectedBoneName]);

  const updateBoneRotationFromScene = useCallback(() => {
    if (!selectedBoneName) return;
    const viewer = leftViewerRef.current;
    if (!viewer) return;
    const symbols = Object.getOwnPropertySymbols(viewer);
    const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
    if (!sceneSym) return;
    const scene = viewer[sceneSym];
    if (!scene) return;

    scene.traverse((child: any) => {
      if (child.isBone && child.name === selectedBoneName) {
        const radToDeg = (rad: number) => Math.round((rad * 180) / Math.PI);
        setBoneRotation({
          x: radToDeg(child.rotation.x),
          y: radToDeg(child.rotation.y),
          z: radToDeg(child.rotation.z),
        });
      }
    });
  }, [selectedBoneName]);

  const {
    isPlaying,
    isPlayingRef,
    promptText,
    setPromptText,
    jsonText,
    setJsonText,
    playAnimationLoop,
    stopAnimation,
  } = useAnimationPlayer(
    leftViewerRef,
    poses,
    setIkLegsEnabled,
    ikLegsEnabledRef,
    setIkArmsEnabled,
    ikArmsEnabledRef,
    updateModelPoseCb,
    updateBoneRotationFromScene
  );

  // Auto-play URL animation sequence in Full Screen mode
  const urlAnimationJson = React.useMemo(() => parseAnimationFromUrl(), []);
  const [isFullScreen, setIsFullScreen] = React.useState<boolean>(!!urlAnimationJson);
  const autoPlayedRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullScreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!urlAnimationJson || autoPlayedRef.current) return;
    if (poses.length === 0) return;

    const checkInterval = setInterval(() => {
      const viewer = leftViewerRef.current;
      const THREE = (window as any).THREE;
      if (viewer && THREE) {
        const symbols = Object.getOwnPropertySymbols(viewer);
        const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
        if (sceneSym && viewer[sceneSym]) {
          let hasBones = false;
          viewer[sceneSym].traverse((child: any) => {
            if (child.isBone) hasBones = true;
          });
          if (hasBones) {
            clearInterval(checkInterval);
            if (!autoPlayedRef.current) {
              autoPlayedRef.current = true;
              setTimeout(() => {
                playAnimationLoop(urlAnimationJson);
              }, 500);
            }
          }
        }
      }
    }, 200);

    return () => clearInterval(checkInterval);
  }, [poses, urlAnimationJson, playAnimationLoop]);

  // Ensure Three.js bundle is initialized once on Web
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    loadThreeBundle().catch((err) => console.error('Failed to load Three.js:', err));
  }, []);

  // Update 3D scene whenever bone selection or IK state changes
  useEffect(() => {
    updateBoneRotationFromScene();
    updateSelectedBoneLockFromScene();

    const viewer = leftViewerRef.current;
    const THREE = (window as any).THREE;
    if (viewer && THREE) {
      const symbols = Object.getOwnPropertySymbols(viewer);
      const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
      if (sceneSym) {
        const scene = viewer[sceneSym];
        if (scene) {
          updateModelPoseCb(scene, THREE);
          if (typeof viewer.queueRender === 'function') {
            viewer.queueRender();
          }
        }
      }
    }
  }, [selectedBoneName, updateBoneRotationFromScene, updateSelectedBoneLockFromScene, updateModelPoseCb]);

  useEffect(() => {
    const viewer = leftViewerRef.current;
    const THREE = (window as any).THREE;
    if (viewer && THREE) {
      const symbols = Object.getOwnPropertySymbols(viewer);
      const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
      if (sceneSym) {
        const scene = viewer[sceneSym];
        if (scene) {
          updateModelPoseCb(scene, THREE);
          if (typeof viewer.queueRender === 'function') {
            viewer.queueRender();
          }
        }
      }
    }
  }, [ikLegsEnabled, ikArmsEnabled, updateModelPoseCb]);

  // Bone transformation & control handlers
  const handleRotateBone = (axis: 'x' | 'y' | 'z', value: number) => {
    const viewer = leftViewerRef.current;
    if (!viewer || !selectedBoneName) return;
    const symbols = Object.getOwnPropertySymbols(viewer);
    const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
    if (!sceneSym) return;
    const scene = viewer[sceneSym];
    if (!scene) return;

    const isArm = isArmBone(selectedBoneName);
    const isLeg = isLegBone(selectedBoneName);
    const isSymmetric = (isArm && symmetricArmsEnabled) || (isLeg && symmetricLegsEnabled);
    const counterpartName = isSymmetric && selectedBoneName.includes('_R_') ? getCounterpartBoneName(selectedBoneName) : null;

    scene.traverse((child: any) => {
      if (child.isBone) {
        const degToRad = (deg: number) => (deg * Math.PI) / 180;
        if (child.name === selectedBoneName) {
          child.rotation[axis] = degToRad(value);
          child.updateMatrixWorld(true);
        } else if (counterpartName && child.name === counterpartName) {
          const oppositeValue = axis === 'x' ? value : -value;
          child.rotation[axis] = degToRad(oppositeValue);
          child.updateMatrixWorld(true);
        }
      }
    });

    setBoneRotation((prev) => ({
      ...prev,
      [axis]: value,
    }));

    const THREE = (window as any).THREE;
    if (THREE) {
      updateModelPoseCb(scene, THREE);
    }

    if (typeof viewer.queueRender === 'function') {
      viewer.queueRender();
    }

    if (selectedPoseId) {
      triggerAutoSave(selectedPoseId);
    }
  };

  const handleResetAxisToDetected = (axis: 'x' | 'y' | 'z') => {
    if (!selectedBoneName) return;
    const targetKey = selectedPoseId || '__global__';
    const currentDetectedPose = lastDetectedPoses[targetKey];
    if (!currentDetectedPose) return;

    const viewer = leftViewerRef.current;
    if (!viewer) return;
    const symbols = Object.getOwnPropertySymbols(viewer);
    const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
    if (!sceneSym) return;
    const scene = viewer[sceneSym];
    if (!scene) return;

    const detectedBone = currentDetectedPose.find((b: any) => b.name === selectedBoneName);
    if (!detectedBone || !detectedBone.rotation) return;

    const targetRad = detectedBone.rotation[axis];
    const targetDeg = Math.round((targetRad * 180) / Math.PI);

    const isArm = isArmBone(selectedBoneName);
    const isLeg = isLegBone(selectedBoneName);
    const isSymmetric = (isArm && symmetricArmsEnabled) || (isLeg && symmetricLegsEnabled);
    const counterpartName = isSymmetric && selectedBoneName.includes('_R_') ? getCounterpartBoneName(selectedBoneName) : null;

    scene.traverse((child: any) => {
      if (child.isBone) {
        if (child.name === selectedBoneName) {
          child.rotation[axis] = targetRad;
          child.updateMatrixWorld(true);
        } else if (counterpartName && child.name === counterpartName) {
          const oppositeRad = axis === 'x' ? targetRad : -targetRad;
          child.rotation[axis] = oppositeRad;
          child.updateMatrixWorld(true);
        }
      }
    });

    setBoneRotation((prev) => ({
      ...prev,
      [axis]: targetDeg,
    }));

    const THREE = (window as any).THREE;
    if (THREE) {
      updateModelPoseCb(scene, THREE);
    }

    if (typeof viewer.queueRender === 'function') {
      viewer.queueRender();
    }

    if (selectedPoseId) {
      triggerAutoSave(selectedPoseId);
    }
  };

  const handleToggleLockToFloor = () => {
    const viewer = leftViewerRef.current;
    if (!viewer || !selectedBoneName) return;
    const symbols = Object.getOwnPropertySymbols(viewer);
    const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
    if (!sceneSym) return;
    const scene = viewer[sceneSym];
    if (!scene) return;

    let newValue = false;
    scene.traverse((child: any) => {
      if (child.isBone && child.name === selectedBoneName) {
        child.userData.lockToFloor = !child.userData.lockToFloor;
        newValue = child.userData.lockToFloor;
      }
    });

    setSelectedBoneLocked(newValue);

    const THREE = (window as any).THREE;
    if (THREE) {
      updateModelPoseCb(scene, THREE);
      if (typeof viewer.queueRender === 'function') {
        viewer.queueRender();
      }
    }

    if (selectedPoseId) {
      triggerAutoSave(selectedPoseId);
    }
  };

  const handleToggleIkLegs = () => {
    const next = !ikLegsEnabled;
    setIkLegsEnabled(next);
    ikLegsEnabledRef.current = next;
    if (selectedPoseId) {
      triggerAutoSave(selectedPoseId);
    }
  };

  const handleToggleIkArms = () => {
    const next = !ikArmsEnabled;
    setIkArmsEnabled(next);
    ikArmsEnabledRef.current = next;
    if (selectedPoseId) {
      triggerAutoSave(selectedPoseId);
    }
  };

  const handleToggleSymmetricArms = () => {
    const next = !symmetricArmsEnabled;
    setSymmetricArmsEnabled(next);
    symmetricArmsEnabledRef.current = next;

    if (next && selectedBoneName && selectedBoneName.includes('_L_') && isArmBone(selectedBoneName)) {
      const counterpart = getCounterpartBoneName(selectedBoneName);
      if (counterpart) {
        setSelectedBoneName(counterpart);
      }
    }

    if (next) {
      const viewer = leftViewerRef.current;
      if (viewer) {
        const symbols = Object.getOwnPropertySymbols(viewer);
        const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
        if (sceneSym) {
          const scene = viewer[sceneSym];
          if (scene) {
            enforceSymmetry(scene, true, symmetricLegsEnabledRef.current);
            const THREE = (window as any).THREE;
            if (THREE) {
              updateModelPoseCb(scene, THREE);
            }
            if (typeof viewer.queueRender === 'function') {
              viewer.queueRender();
            }
          }
        }
      }
    }

    if (selectedPoseId) {
      triggerAutoSave(selectedPoseId);
    }
  };

  const handleToggleSymmetricLegs = () => {
    const next = !symmetricLegsEnabled;
    setSymmetricLegsEnabled(next);
    symmetricLegsEnabledRef.current = next;

    if (next && selectedBoneName && selectedBoneName.includes('_L_') && isLegBone(selectedBoneName)) {
      const counterpart = getCounterpartBoneName(selectedBoneName);
      if (counterpart) {
        setSelectedBoneName(counterpart);
      }
    }

    if (next) {
      const viewer = leftViewerRef.current;
      if (viewer) {
        const symbols = Object.getOwnPropertySymbols(viewer);
        const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
        if (sceneSym) {
          const scene = viewer[sceneSym];
          if (scene) {
            enforceSymmetry(scene, symmetricArmsEnabledRef.current, true);
            const THREE = (window as any).THREE;
            if (THREE) {
              updateModelPoseCb(scene, THREE);
            }
            if (typeof viewer.queueRender === 'function') {
              viewer.queueRender();
            }
          }
        }
      }
    }

    if (selectedPoseId) {
      triggerAutoSave(selectedPoseId);
    }
  };

  const handleSelectPose = (pose: any) => {
    setSelectedPoseId(pose.id);
    const viewer = leftViewerRef.current;
    if (!viewer || !pose.skeleton) return;

    const symbols = Object.getOwnPropertySymbols(viewer);
    const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
    if (!sceneSym) return;

    const scene = viewer[sceneSym];
    if (!scene) return;

    const boneMap = new Map<string, any>();
    scene.traverse((child: any) => {
      if (child.isBone) {
        boneMap.set(child.name, child);
        child.userData.lockToFloor = false;
      }
    });

    const ikGlobal = pose.skeleton.find((b: any) => b.name === '__ik_global__');
    if (ikGlobal) {
      const legs = !!ikGlobal.ikLegsEnabled;
      const arms = !!ikGlobal.ikArmsEnabled;
      const symArms = ikGlobal.symmetricArmsEnabled !== undefined ? !!ikGlobal.symmetricArmsEnabled : !!ikGlobal.symmetricEnabled;
      const symLegs = ikGlobal.symmetricLegsEnabled !== undefined ? !!ikGlobal.symmetricLegsEnabled : !!ikGlobal.symmetricEnabled;
      setIkLegsEnabled(legs);
      ikLegsEnabledRef.current = legs;
      setIkArmsEnabled(arms);
      ikArmsEnabledRef.current = arms;
      setSymmetricArmsEnabled(symArms);
      symmetricArmsEnabledRef.current = symArms;
      setSymmetricLegsEnabled(symLegs);
      symmetricLegsEnabledRef.current = symLegs;
    } else {
      setIkLegsEnabled(false);
      ikLegsEnabledRef.current = false;
      setIkArmsEnabled(false);
      ikArmsEnabledRef.current = false;
      setSymmetricArmsEnabled(false);
      symmetricArmsEnabledRef.current = false;
      setSymmetricLegsEnabled(false);
      symmetricLegsEnabledRef.current = false;
    }

    pose.skeleton.forEach((savedBone: any) => {
      if (savedBone.name === '__ik_global__') return;
      const bone = boneMap.get(savedBone.name);
      if (bone) {
        if (savedBone.rotation) {
          bone.rotation.x = savedBone.rotation.x;
          bone.rotation.y = savedBone.rotation.y;
          bone.rotation.z = savedBone.rotation.z;
        }
        if (savedBone.position) {
          bone.position.x = savedBone.position.x;
          bone.position.y = savedBone.position.y;
          bone.position.z = savedBone.position.z;
        }
        bone.userData.lockToFloor = !!savedBone.lockToFloor;
      }
    });

    if (selectedBoneName) {
      const selectedBone = boneMap.get(selectedBoneName);
      setSelectedBoneLocked(selectedBone ? !!selectedBone.userData.lockToFloor : false);
    }

    const THREE = (window as any).THREE;
    if (THREE) {
      setTimeout(() => {
        updateModelPoseCb(scene, THREE);
        if (typeof viewer.queueRender === 'function') {
          viewer.queueRender();
        }
      }, 0);
    }

    setTimeout(() => {
      updateBoneRotationFromScene();
    }, 50);
  };

  const handleResetPose = () => {
    const viewer = leftViewerRef.current;
    if (!viewer) return;

    const symbols = Object.getOwnPropertySymbols(viewer);
    const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
    if (!sceneSym) return;

    const scene = viewer[sceneSym];
    if (!scene) return;

    console.log('[Pose Debug] Resetting skeleton to default bind pose');

    setIkLegsEnabled(false);
    ikLegsEnabledRef.current = false;
    setIkArmsEnabled(false);
    ikArmsEnabledRef.current = false;
    setSelectedBoneLocked(false);

    if (defaultPoseRef.current) {
      const boneMap = new Map<string, any>();
      scene.traverse((child: any) => {
        if (child.isBone) {
          boneMap.set(child.name, child);
          child.userData.lockToFloor = false;
        }
      });

      defaultPoseRef.current.forEach((savedBone: any) => {
        const bone = boneMap.get(savedBone.name);
        if (bone) {
          if (savedBone.rotation) {
            bone.rotation.x = savedBone.rotation.x;
            bone.rotation.y = savedBone.rotation.y;
            bone.rotation.z = savedBone.rotation.z;
          }
          if (savedBone.position) {
            bone.position.x = savedBone.position.x;
            bone.position.y = savedBone.position.y;
            bone.position.z = savedBone.position.z;
          }
        }
      });
    }

    scene.traverse((child: any) => {
      if (child.isBone) {
        child.updateMatrixWorld(true);
      }
    });

    const THREE = (window as any).THREE;
    if (THREE) {
      updateModelPoseCb(scene, THREE);
    }

    if (typeof viewer.queueRender === 'function') {
      viewer.queueRender();
    }

    setTimeout(() => {
      updateBoneRotationFromScene();
    }, 50);

    if (selectedPoseId) {
      triggerAutoSave(selectedPoseId);
    }
  };

  const handleDetectPose = () => {
    if (Platform.OS !== 'web') return;
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handlePoseImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';

    try {
      setDetectingPose(true);

      const fileDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const THREE = (window as any).THREE;
      if (!THREE) {
        throw new Error('Three.js is not loaded yet. Please wait a moment and try again.');
      }

      const hybrikResult = await inferBase64Image(fileDataUrl);

      if (hybrikResult && hybrikResult.success && hybrikResult.joints_3d && hybrikResult.joints_3d.length > 0) {
        const viewer = leftViewerRef.current;
        if (!viewer) {
          throw new Error('3D Model Viewer is not ready.');
        }

        const symbols = Object.getOwnPropertySymbols(viewer);
        const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
        if (!sceneSym) {
          throw new Error('Could not find 3D Model Scene.');
        }

        const scene = viewer[sceneSym];
        if (!scene) {
          throw new Error('3D Model Scene is not loaded.');
        }

        handleResetPose();

        applyHybrIKPoseToModel(scene, hybrikResult, THREE);

        if (THREE) {
          updateModelPoseCb(scene, THREE);
        }

        if (typeof viewer.queueRender === 'function') {
          viewer.queueRender();
        }

        setTimeout(() => {
          updateBoneRotationFromScene();
        }, 50);

        const detectedSkeleton = getCurrentSkeletonBones();
        console.log(`[Pose Detection] Pose detection updated ${detectedSkeleton.length} clean skeleton entries.`);
        if (detectedSkeleton.length > 0) {
          const targetKey = selectedPoseId || '__global__';
          setLastDetectedPoses((prev) => {
            const updated = { ...prev, [targetKey]: detectedSkeleton };
            if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.setItem('vyom_last_detected_poses_map', JSON.stringify(updated));
            }
            return updated;
          });
        }

        if (selectedPoseId) {
          const finalSkeleton = getCurrentSkeletonBones();
          if (finalSkeleton.length > 0) {
            setPoses((prev) => {
              const updated = prev.map((p) =>
                p.id === selectedPoseId
                  ? { ...p, skeleton: finalSkeleton, lastDetectedPose: finalSkeleton }
                  : p
              );
              if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem('vyom_saved_poses', JSON.stringify(updated));
              }
              return updated;
            });
          }
        }
      } else {
        alert(hybrikResult.message || 'No human pose could be detected in the image.');
      }
    } catch (err: any) {
      console.error('Error in pose detection:', err);
      alert(err.message || 'An error occurred during pose detection.');
    } finally {
      setDetectingPose(false);
    }
  };

  const handleCopyCords = () => {
    copyCoords(leftViewerRef, selectedBoneName);
  };

  const handlePasteCords = () => {
    if (selectedPoseId) {
      pasteCoords(leftViewerRef, selectedBoneName, () => triggerAutoSave(selectedPoseId), updateModelPoseCb);
    } else {
      pasteCoords(leftViewerRef, selectedBoneName, () => {}, updateModelPoseCb);
    }
  };

  if (isFullScreen) {
    return (
      <View style={styles.fullScreenWrapper}>
        <ModelViewer
          ref={leftViewerRef}
          src="/amber.glb"
          roomTheme="white"
          lockCamera={true}
          style={styles.fullScreenViewer}
        />
      </View>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <HeaderNavigation
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        headerHovered={headerHovered}
        setHeaderHovered={setHeaderHovered}
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <SafeAreaView style={styles.safeArea}>
          {activeTab === 'meditation' ? (
            <MeditationModule />
          ) : activeTab === 'mesh' ? (
            <MeshViewer />
          ) : (
            <ThemedView style={styles.editorLayout}>
              {/* Poses Sidebar (Poses Mode ONLY) */}
              {activeTab === 'poses' && (
                <PoseSidebar
                  poses={poses}
                  loadingPoses={loadingPoses}
                  selectedPoseId={selectedPoseId}
                  onSelectPose={handleSelectPose}
                  onDeletePose={handleDeletePose}
                  showAddDialog={showAddDialog}
                  setShowAddDialog={setShowAddDialog}
                  newPoseName={newPoseName}
                  setNewPoseName={setNewPoseName}
                  addingPose={addingPose}
                  onAddPose={handleAddPose}
                />
              )}

              {/* Left Column: JSON Textarea (Animation Mode ONLY) */}
              {activeTab === 'animation' && (
                <AnimationSidebar
                  jsonText={jsonText}
                  setJsonText={setJsonText}
                  promptText={promptText}
                  setPromptText={setPromptText}
                />
              )}

              {/* Right Column: Model Viewers */}
              <View style={styles.viewerContainer}>
                {activeTab === 'poses' ? (
                  <View style={styles.dualViewerWrapper}>
                    <ThemedView style={styles.viewerColumn}>
                      <ModelViewer
                        ref={leftViewerRef}
                        src="/amber.glb"
                        roomTheme="white"
                        lockCamera={!!urlAnimationJson}
                        style={styles.viewerHeight}
                      />
                    </ThemedView>

                    <ThemedView style={styles.viewerColumn}>
                      <ThemedView style={styles.skeletonRow}>
                        <SkeletonViewer
                          sourceViewerRef={leftViewerRef}
                          style={styles.skeletonCanvas}
                          selectedBoneName={selectedBoneName}
                          onSelectBone={setSelectedBoneName}
                          symmetricArmsEnabled={symmetricArmsEnabled}
                          symmetricLegsEnabled={symmetricLegsEnabled}
                        />
                        <BoneTreeView
                          sourceViewerRef={leftViewerRef}
                          style={styles.boneTree}
                          selectedBoneName={selectedBoneName}
                          onSelectBone={setSelectedBoneName}
                          symmetricArmsEnabled={symmetricArmsEnabled}
                          onToggleSymmetricArms={handleToggleSymmetricArms}
                          symmetricLegsEnabled={symmetricLegsEnabled}
                          onToggleSymmetricLegs={handleToggleSymmetricLegs}
                          ikLegsEnabled={ikLegsEnabled}
                          onToggleIkLegs={handleToggleIkLegs}
                          ikArmsEnabled={ikArmsEnabled}
                          onToggleIkArms={handleToggleIkArms}
                        />
                      </ThemedView>
                    </ThemedView>
                  </View>
                ) : (
                  <View style={{ flex: 1, gap: 16 }}>
                    <ModelViewer
                      ref={leftViewerRef}
                      src="/amber.glb"
                      roomTheme="white"
                      lockCamera={!!urlAnimationJson}
                      style={styles.viewerHeight}
                    />

                    {/* Play controls and transition sequence status */}
                    <AnimationControls
                      isPlaying={isPlaying}
                      onPlay={isPlaying ? stopAnimation : playAnimationLoop}
                      onStop={stopAnimation}
                      onToggleFullScreen={() => setIsFullScreen(true)}
                    />
                  </View>
                )}
              </View>
            </ThemedView>
          )}
        </SafeAreaView>
      </ScrollView>

      {/* HyBR-IK Pose Detection Loading Modal */}
      <DetectingPoseModal visible={detectingPose} />

      {/* Floating Details & Rotation JSON Panels */}
      {activeTab === 'poses' && (
        <View style={styles.bottomControlsContainer}>
          {selectedBoneName && (
            <BoneDetailsPanel
              selectedPoseId={selectedPoseId}
              selectedBoneName={selectedBoneName}
              selectedBoneLocked={selectedBoneLocked}
              boneRotation={boneRotation}
              lastDetectedPoses={lastDetectedPoses}
              clipboardCoords={clipboardCoords}
              onToggleLockToFloor={handleToggleLockToFloor}
              onRotateBone={handleRotateBone}
              onResetAxisToDetected={handleResetAxisToDetected}
              onCopyCords={handleCopyCords}
              onPasteCords={handlePasteCords}
            />
          )}
          <CleanHierarchyRotationPanel
            sourceViewerRef={leftViewerRef}
            onRotationsApplied={updateBoneRotationFromScene}
            updateModelPoseCb={updateModelPoseCb}
          />
        </View>
      )}

      {/* Hidden File Input for Pose Detection */}
      {Platform.OS === 'web' && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handlePoseImageSelect}
        />
      )}

      {/* Pose Actions Floating Action Buttons */}
      {activeTab === 'poses' && (
        <PoseFabContainer onResetPose={handleResetPose} onDetectPose={handleDetectPose} />
      )}
    </ThemedView>
  );
}
