import { useState, useRef, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import defaultPoseData from '../app/default_pose.json';
import { getSkeletonBones } from '@/utils/model-pose-solver';
import { api } from '@/services/api';

export function usePosesManager(
  viewerRef: any,
  ikLegsEnabledRef: React.MutableRefObject<boolean>,
  ikArmsEnabledRef: React.MutableRefObject<boolean>,
  symmetricArmsEnabledRef: React.MutableRefObject<boolean>,
  symmetricLegsEnabledRef: React.MutableRefObject<boolean>
) {
  const defaultPoseRef = useRef<any[] | null>(
    defaultPoseData && defaultPoseData.length > 0 ? defaultPoseData : null
  );
  const [poses, setPoses] = useState<any[]>(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem('vyom_saved_poses');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {}
      }
    }
    return [];
  });
  const [loadingPoses, setLoadingPoses] = useState(false);
  const [selectedPoseId, setSelectedPoseId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newPoseName, setNewPoseName] = useState('');
  const [addingPose, setAddingPose] = useState(false);
  const [lastDetectedPoses, setLastDetectedPoses] = useState<{ [poseId: string]: any[] }>(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem('vyom_last_detected_poses_map');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {}
      }
    }
    return {};
  });

  const saveTimeoutRef = useRef<any>(null);

  const fetchPoses = useCallback(async () => {
    try {
      setLoadingPoses(true);
      const res = await api.poses.getPoses({});
      if (res && res.success && Array.isArray(res.poses) && res.poses.length > 0) {
        setPoses(res.poses);
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('vyom_saved_poses', JSON.stringify(res.poses));
        }
      }
    } catch (err) {
      console.warn('[Poses API] Failed to fetch poses from API, using cached poses:', err);
    } finally {
      setLoadingPoses(false);
    }
  }, []);

  useEffect(() => {
    fetchPoses();
  }, [fetchPoses]);

  const getCurrentSkeletonBones = () => {
    return getSkeletonBones(
      viewerRef,
      ikLegsEnabledRef.current,
      ikArmsEnabledRef.current,
      symmetricArmsEnabledRef.current,
      symmetricLegsEnabledRef.current
    );
  };

  const savePoseSkeleton = async (poseId: string, skeleton: any[]) => {
    setPoses((prev) => {
      const updated = prev.map((p) => (p.id === poseId ? { ...p, skeleton } : p));
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('vyom_saved_poses', JSON.stringify(updated));
      }
      return updated;
    });

    try {
      await api.poses.updatePose({
        id: poseId,
        skeleton: skeleton as any,
      });
    } catch (err) {
      console.warn('[Poses API] Failed to update pose via API:', err);
    }
  };

  const triggerAutoSave = (poseId: string) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      const skeleton = getCurrentSkeletonBones();
      if (skeleton.length > 0) {
        savePoseSkeleton(poseId, skeleton);
      }
    }, 500);
  };

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Capture default GLB bind pose once model is loaded
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (defaultPoseRef.current) return;

    const interval = setInterval(() => {
      const bones = getCurrentSkeletonBones();
      if (bones.length > 5 && !defaultPoseRef.current) {
        defaultPoseRef.current = bones;
        console.log('[Pose Debug] Captured default bind pose of model bones:', bones.length);

        api.poses.saveDefaultPose({ skeleton: bones as any })
          .then((res) => {
            console.log('[Pose Debug] Default pose saved successfully via API:', res);
          })
          .catch((err) => {
            console.error('[Pose Debug] Failed to save default pose via API:', err);
          });

        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, []);

  const handleAddPose = async () => {
    if (!newPoseName.trim()) return;
    try {
      setAddingPose(true);
      const skeleton = getCurrentSkeletonBones();
      const name = newPoseName.trim();

      let createdPose: any = null;
      try {
        const res = await api.poses.createPose({
          name,
          skeleton: skeleton as any,
        });
        if (res && res.success && res.pose) {
          createdPose = res.pose;
        }
      } catch (err) {
        console.warn('[Poses API] Failed to create pose via API:', err);
      }

      if (!createdPose) {
        createdPose = {
          id: 'pose_' + Date.now(),
          name,
          skeleton,
        };
      }

      setPoses((prev) => {
        const updated = [...prev, createdPose];
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('vyom_saved_poses', JSON.stringify(updated));
        }
        return updated;
      });
      setShowAddDialog(false);
      setNewPoseName('');
    } catch (err) {
      console.error('Error creating pose:', err);
    } finally {
      setAddingPose(false);
    }
  };

  const handleDeletePose = async (poseId: string, name: string) => {
    const proceed = Platform.OS === 'web' ? window.confirm(`Are you sure you want to delete "${name}"?`) : true;
    if (proceed) {
      try {
        await api.poses.deletePose({ id: poseId });
      } catch (err) {
        console.warn('[Poses API] Failed to delete pose via API:', err);
      }

      setPoses((prev) => {
        const updated = prev.filter((p) => p.id !== poseId);
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('vyom_saved_poses', JSON.stringify(updated));
        }
        return updated;
      });
      if (selectedPoseId === poseId) {
        setSelectedPoseId(null);
      }
    }
  };

  return {
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
  };
}

