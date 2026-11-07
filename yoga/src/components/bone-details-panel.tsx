import React from 'react';
import { Platform, StyleSheet, View, Pressable } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatBoneName } from '@/utils/pose-utils';

interface BoneDetailsPanelProps {
  selectedPoseId: string | null;
  selectedBoneName: string | null;
  selectedBoneLocked: boolean;
  boneRotation: { x: number; y: number; z: number };
  lastDetectedPoses: { [poseId: string]: any[] };
  clipboardCoords: { x: number; y: number; z: number } | null;
  onToggleLockToFloor: () => void;
  onRotateBone: (axis: 'x' | 'y' | 'z', value: number) => void;
  onResetAxisToDetected: (axis: 'x' | 'y' | 'z') => void;
  onCopyCords: () => void;
  onPasteCords: () => void;
}

const AXES_CONFIG = [
  { axis: 'x' as const, label: 'Pitch', icon: '↕️' },
  { axis: 'z' as const, label: 'Yaw', icon: '↔️' },
  { axis: 'y' as const, label: 'Roll', icon: '🔄' },
];

export const BoneDetailsPanel: React.FC<BoneDetailsPanelProps> = ({
  selectedPoseId,
  selectedBoneName,
  selectedBoneLocked,
  boneRotation,
  lastDetectedPoses,
  clipboardCoords,
  onToggleLockToFloor,
  onRotateBone,
  onResetAxisToDetected,
  onCopyCords,
  onPasteCords,
}) => {
  if (!selectedBoneName) return null;

  const targetKey = selectedPoseId || '__global__';
  const currentDetectedPose = lastDetectedPoses[targetKey];
  const activeAxes = AXES_CONFIG;

  return (
    <View style={styles.floatingPanel}>
      <View style={styles.panelHeader}>
        <ThemedText style={styles.panelTitle}>🦴 {formatBoneName(selectedBoneName)}</ThemedText>
        
        {/* Lock to Floor Checkbox */}
        <Pressable
          onPress={onToggleLockToFloor}
          style={styles.checkboxWrapper}
        >
          <View style={[styles.checkbox, selectedBoneLocked && styles.checkboxChecked]}>
            {selectedBoneLocked && <View style={styles.checkboxInner} />}
          </View>
          <ThemedText style={styles.checkboxLabel}>Lock to Floor</ThemedText>
        </Pressable>
      </View>

      <View style={styles.panelSliders}>
        {activeAxes.map(({ axis, label, icon }) => (
          <View key={axis} style={styles.sliderRow}>
            <View style={styles.axisLabelContainer}>
              <ThemedText style={styles.axisIcon}>{icon}</ThemedText>
              <ThemedText style={styles.axisLabel}>{label}</ThemedText>
            </View>
            {Platform.OS === 'web' ? (
              <input
                type="range"
                min="-360"
                max="360"
                value={boneRotation[axis]}
                onChange={(e) => onRotateBone(axis, parseInt(e.target.value))}
                style={{
                  flex: 1,
                  accentColor: '#00ffcc',
                  height: '6px',
                  background: '#222',
                  borderRadius: '3px',
                  outlineStyle: 'none' as any,
                  cursor: 'pointer',
                }}
              />
            ) : (
              <View style={{ flex: 1, height: 2, backgroundColor: '#222' }} />
            )}
            <ThemedText style={styles.sliderValue}>{boneRotation[axis]}°</ThemedText>
            <Pressable
              onPress={() => onResetAxisToDetected(axis)}
              disabled={!currentDetectedPose}
              style={({ pressed }) => [
                {
                  padding: 4,
                  opacity: currentDetectedPose ? (pressed ? 0.6 : 1) : 0.2,
                }
              ]}
            >
              <ThemedText style={{ color: currentDetectedPose ? '#fff' : '#444', fontSize: 13, fontWeight: 'bold' }}>⟲</ThemedText>
            </Pressable>
          </View>
        ))}
      </View>

      <View style={styles.coordsRow}>
        <Pressable
          onPress={onCopyCords}
          style={({ pressed }) => [
            styles.coordsButton,
            pressed && { opacity: 0.8 }
          ]}
        >
          <ThemedText style={styles.coordsButtonText}>📋 Copy Cords</ThemedText>
        </Pressable>
        <Pressable
          onPress={onPasteCords}
          disabled={!clipboardCoords}
          style={({ pressed }) => [
            styles.coordsButton,
            clipboardCoords && styles.coordsButtonActive,
            pressed && clipboardCoords && { opacity: 0.8 },
            !clipboardCoords && { opacity: 0.5 }
          ]}
        >
          <ThemedText style={[
            styles.coordsButtonText,
            clipboardCoords && styles.coordsButtonTextActive
          ]}>
            📥 Paste Cords
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  floatingPanel: {
    width: 380,
    maxWidth: 420,
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
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
    fontFamily: 'monospace',
  },
  checkboxWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  } as any,
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#00ffcc',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#00ffcc',
  },
  checkboxInner: {
    width: 8,
    height: 8,
    borderRadius: 1,
    backgroundColor: '#000',
  },
  checkboxLabel: {
    fontSize: 12,
    color: '#ccc',
    fontWeight: '500',
  },
  panelSliders: {
    gap: Spacing.two,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  axisLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 68,
    gap: 6,
  },
  axisIcon: {
    fontSize: 13,
  },
  axisLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#888',
  },
  sliderValue: {
    width: 44,
    textAlign: 'right',
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#00ffcc',
  },
  coordsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
  },
  coordsButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  coordsButtonText: {
    fontSize: 12,
    color: '#ccc',
    fontWeight: '600',
  },
  coordsButtonActive: {
    backgroundColor: '#00ffcc',
    borderColor: '#00ffcc',
  },
  coordsButtonTextActive: {
    color: '#000',
    fontWeight: 'bold',
  },
});
