import React, { useState } from 'react';
import { Platform, StyleSheet, View, Pressable } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getCleanBoneRotationsJson, applyCleanBoneRotationsJson } from '@/utils/pose-utils';

interface CleanHierarchyRotationPanelProps {
  sourceViewerRef: React.RefObject<any>;
  onRotationsApplied?: () => void;
  updateModelPoseCb?: (scene: any, THREE: any) => void;
}

export const CleanHierarchyRotationPanel: React.FC<CleanHierarchyRotationPanelProps> = ({
  sourceViewerRef,
  onRotationsApplied,
  updateModelPoseCb,
}) => {
  const [jsonText, setJsonText] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const getScene = () => {
    const viewer = sourceViewerRef.current;
    if (!viewer) return null;
    const symbols = Object.getOwnPropertySymbols(viewer);
    const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
    return sceneSym ? viewer[sceneSym] : null;
  };

  const handleCopyCleanJson = async () => {
    const scene = getScene();
    if (!scene) {
      setToastMsg('3D scene not ready');
      setTimeout(() => setToastMsg(null), 2000);
      return;
    }
    const jsonStr = getCleanBoneRotationsJson(scene);
    setJsonText(jsonStr);

    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(jsonStr);
        setToastMsg('Copied to Clipboard!');
      } catch (e) {
        setToastMsg('JSON Copied!');
      }
    } else {
      setToastMsg('JSON Copied!');
    }
    setTimeout(() => setToastMsg(null), 2500);
  };

  const handlePasteClipboard = async () => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          setJsonText(text);
          setToastMsg('Pasted!');
          setTimeout(() => setToastMsg(null), 2000);
        }
      } catch (e) {
        setToastMsg('Paste into box manually');
        setTimeout(() => setToastMsg(null), 2000);
      }
    }
  };

  const handleApplyJson = () => {
    if (!jsonText.trim()) {
      setToastMsg('Please enter JSON first');
      setTimeout(() => setToastMsg(null), 2000);
      return;
    }
    const scene = getScene();
    if (!scene) {
      setToastMsg('3D scene not ready');
      setTimeout(() => setToastMsg(null), 2000);
      return;
    }

    const result = applyCleanBoneRotationsJson(scene, jsonText);
    if (result.error) {
      setToastMsg(`Error: ${result.error}`);
      setTimeout(() => setToastMsg(null), 3000);
    } else {
      setToastMsg(`Applied to ${result.appliedCount} bones!`);
      setTimeout(() => setToastMsg(null), 2500);

      const THREE = (window as any).THREE;
      if (THREE && updateModelPoseCb) {
        updateModelPoseCb(scene, THREE);
      }
      const viewer = sourceViewerRef.current;
      if (viewer && typeof viewer.queueRender === 'function') {
        viewer.queueRender();
      }
      if (onRotationsApplied) {
        onRotationsApplied();
      }
    }
  };

  return (
    <View style={styles.floatingPanel}>
      <View style={styles.panelHeader}>
        <ThemedText style={styles.panelTitle}>📄 Hierarchy Rotation JSON</ThemedText>
        {toastMsg && <ThemedText style={styles.toastText}>{toastMsg}</ThemedText>}
      </View>

      <View style={styles.inputContainer}>
        {Platform.OS === 'web' ? (
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder="Paste clean bone rotation JSON here..."
            style={{
              width: '100%',
              height: '80px',
              backgroundColor: '#111111',
              color: '#00ffcc',
              border: '1px solid #222222',
              borderRadius: '8px',
              padding: '8px',
              fontFamily: 'monospace',
              fontSize: '11px',
              resize: 'none',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <View style={{ height: 80, backgroundColor: '#111', borderRadius: 8 }} />
        )}
      </View>

      <View style={styles.actionsRow}>
        <Pressable
          onPress={handleCopyCleanJson}
          style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.8 }]}
        >
          <ThemedText style={styles.actionButtonText}>📋 Copy JSON</ThemedText>
        </Pressable>

        <Pressable
          onPress={handlePasteClipboard}
          style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.8 }]}
        >
          <ThemedText style={styles.actionButtonText}>📥 Paste</ThemedText>
        </Pressable>

        <Pressable
          onPress={handleApplyJson}
          style={({ pressed }) => [
            styles.actionButton,
            styles.applyButton,
            pressed && { opacity: 0.8 },
          ]}
        >
          <ThemedText style={styles.applyButtonText}>⚡ Apply</ThemedText>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  floatingPanel: {
    width: 360,
    backgroundColor: 'rgba(10, 10, 10, 0.95)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: Spacing.three,
    gap: Spacing.two,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 8,
    zIndex: 998,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#fff',
    fontFamily: 'monospace',
  },
  toastText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#00ffcc',
  },
  inputContainer: {
    width: '100%',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  actionButtonText: {
    fontSize: 11,
    color: '#ccc',
    fontWeight: '600',
  },
  applyButton: {
    backgroundColor: '#00ffcc',
    borderColor: '#00ffcc',
  },
  applyButtonText: {
    fontSize: 11,
    color: '#000',
    fontWeight: 'bold',
  },
});
