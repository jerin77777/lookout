import React from 'react';
import { Platform, StyleSheet, View, Pressable } from 'react-native';
import { ThemedText } from '@/components/themed-text';

interface PoseFabContainerProps {
  onResetPose: () => void;
  onDetectPose: () => void;
}

export const PoseFabContainer: React.FC<PoseFabContainerProps> = ({
  onResetPose,
  onDetectPose,
}) => {
  if (Platform.OS !== 'web') {
    return null;
  }

  return (
    <View style={styles.fabContainer}>
      <Pressable
        onPress={onResetPose}
        style={({ pressed }) => [
          styles.fabReset,
          pressed && { opacity: 0.8 }
        ]}
      >
        <ThemedText style={styles.fabResetText}>🔄 Reset Pose</ThemedText>
      </Pressable>
      <Pressable
        onPress={onDetectPose}
        style={({ pressed }) => [
          styles.fab,
          pressed && { opacity: 0.8 }
        ]}
      >
        <ThemedText style={styles.fabText}>📸 Detect Pose</ThemedText>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  fabContainer: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    flexDirection: 'row',
    gap: 12,
    zIndex: 999,
  },
  fab: {
    backgroundColor: '#00ffcc',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  fabText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  fabReset: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  fabResetText: {
    color: '#aaa',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
