import { useState, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import { parseCoords } from '@/utils/pose-utils';

export function useClipboardCoords(selectedBoneName: string | null) {
  const [clipboardCoords, setClipboardCoords] = useState<{ x: number; y: number; z: number } | null>(null);

  const checkClipboard = useCallback(async () => {
    try {
      if (typeof localStorage !== 'undefined') {
        const local = localStorage.getItem('vyom_copied_coords');
        if (local) {
          const parsed = JSON.parse(local);
          if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number' && typeof parsed.z === 'number') {
            setClipboardCoords(parsed);
            return;
          }
        }
      }
    } catch (e) {}

    if (Platform.OS === 'web' && navigator.clipboard) {
      try {
        let canRead = true;
        if (navigator.permissions && (navigator.permissions as any).query) {
          const permission = await navigator.permissions.query({ name: 'clipboard-read' as any });
          if (permission.state === 'denied') {
            canRead = false;
          }
        }
        if (canRead) {
          const text = await navigator.clipboard.readText();
          const parsed = parseCoords(text);
          if (parsed) {
            setClipboardCoords(parsed);
            return;
          }
        }
      } catch (err) {}
    }
    setClipboardCoords(null);
  }, []);

  useEffect(() => {
    checkClipboard();
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('focus', checkClipboard);
      return () => {
        window.removeEventListener('focus', checkClipboard);
      };
    }
  }, [selectedBoneName, checkClipboard]);

  const copyCoords = (viewerRef: any, boneName: string | null) => {
    const viewer = viewerRef.current;
    if (!viewer || !boneName) return;
    const symbols = Object.getOwnPropertySymbols(viewer);
    const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
    if (!sceneSym) return;
    const scene = viewer[sceneSym];
    if (!scene) return;
    const THREE = (window as any).THREE;
    if (!THREE) return;

    const worldPos = new THREE.Vector3();
    let found = false;
    scene.traverse((child: any) => {
      if (child.isBone && child.name === boneName) {
        child.getWorldPosition(worldPos);
        found = true;
      }
    });

    if (found) {
      const coordsText = `${worldPos.x.toFixed(4)}, ${worldPos.y.toFixed(4)}, ${worldPos.z.toFixed(4)}`;
      if (Platform.OS === 'web' && navigator.clipboard) {
        navigator.clipboard.writeText(coordsText)
          .then(() => {
            console.log('[Coords] Copied to system clipboard:', coordsText);
          })
          .catch(err => {
            console.error('[Coords] Failed to copy to clipboard:', err);
          });
      }
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('vyom_copied_coords', JSON.stringify({
            x: worldPos.x,
            y: worldPos.y,
            z: worldPos.z,
          }));
        }
      } catch (e) {}

      setClipboardCoords({
        x: worldPos.x,
        y: worldPos.y,
        z: worldPos.z,
      });
    }
  };

  const pasteCoords = async (
    viewerRef: any,
    boneName: string | null,
    onPoseModified: () => void,
    updateModelPoseCb: (scene: any, THREE: any) => void
  ) => {
    let targetCoords: { x: number; y: number; z: number } | null = clipboardCoords;

    if (Platform.OS === 'web' && navigator.clipboard) {
      try {
        const text = await navigator.clipboard.readText();
        const parsed = parseCoords(text);
        if (parsed) {
          targetCoords = parsed;
        }
      } catch (err) {}
    }

    if (!targetCoords) return;

    const viewer = viewerRef.current;
    if (!viewer || !boneName) return;
    const symbols = Object.getOwnPropertySymbols(viewer);
    const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
    if (!sceneSym) return;
    const scene = viewer[sceneSym];
    if (!scene) return;
    const THREE = (window as any).THREE;
    if (!THREE) return;

    let model: any = null;
    scene.traverse((child: any) => {
      if (child.isBone && (child.name === 'CC_Base_BoneRoot' || child.name === 'CS_Base_BoneRoot')) {
        let curr = child;
        while (curr.parent && curr.parent !== scene) {
          curr = curr.parent;
        }
        model = curr;
      }
    });

    if (!model) return;

    const boneWorldPos = new THREE.Vector3();
    let found = false;
    scene.traverse((child: any) => {
      if (child.isBone && child.name === boneName) {
        child.getWorldPosition(boneWorldPos);
        found = true;
      }
    });

    if (found) {
      const targetPos = new THREE.Vector3(targetCoords.x, targetCoords.y, targetCoords.z);
      const translation = new THREE.Vector3().subVectors(targetPos, boneWorldPos);

      const B = scene.getObjectByName('CC_Base_BoneRoot') || scene.getObjectByName('CS_Base_BoneRoot');
      if (B) {
        const currentWorldPosOfB = new THREE.Vector3();
        B.getWorldPosition(currentWorldPosOfB);
        const newWorldPosOfB = currentWorldPosOfB.clone().add(translation);
        if (B.parent) {
          B.parent.worldToLocal(newWorldPosOfB);
        }
        B.position.copy(newWorldPosOfB);
        B.updateMatrixWorld(true);
      } else {
        model.position.add(translation);
        model.updateMatrixWorld(true);
      }

      updateModelPoseCb(scene, THREE);

      if (typeof viewer.queueRender === 'function') {
        viewer.queueRender();
      }

      onPoseModified();
    }
  };

  return {
    clipboardCoords,
    checkClipboard,
    copyCoords,
    pasteCoords,
  };
}
