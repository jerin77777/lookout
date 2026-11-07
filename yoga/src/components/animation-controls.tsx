import React from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

interface AnimationControlsProps {
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onToggleFullScreen?: () => void;
}

export const AnimationControls: React.FC<AnimationControlsProps> = ({
  isPlaying,
  onPlay,
  onStop,
  onToggleFullScreen,
}) => {
  return (
    <ThemedView style={styles.controlsCard}>
      <View style={styles.row}>
        <View style={styles.buttonGroup}>
          <Pressable 
            onPress={onStop}
            disabled={!isPlaying}
            style={({ pressed }) => [
              styles.stopButton,
              { opacity: isPlaying ? 1 : 0.4 },
              pressed && isPlaying && { opacity: 0.8 }
            ]}
          >
            <ThemedText style={styles.stopButtonText}>⏹ Stop</ThemedText>
          </Pressable>
          <Pressable 
            onPress={onPlay}
            style={({ pressed }) => [
              styles.playButton,
              pressed && { opacity: 0.8 }
            ]}
          >
            <ThemedText style={styles.playButtonText}>
              {isPlaying ? '⏸ Pause' : '▶ Play Sequence'}
            </ThemedText>
          </Pressable>
          {onToggleFullScreen && (
            <Pressable
              onPress={onToggleFullScreen}
              style={({ pressed }) => [
                styles.fullScreenBtn,
                pressed && { opacity: 0.8 }
              ]}
            >
              <ThemedText style={styles.fullScreenBtnText}>⛶ Full Screen</ThemedText>
            </Pressable>
          )}
        </View>
        <ThemedText style={styles.statusText}>
          {isPlaying ? 'Playing Sequence...' : 'Sequence Idle'}
        </ThemedText>
      </View>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  controlsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    padding: 20,
    gap: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  buttonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stopButton: {
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  stopButtonText: {
    color: '#333333',
    fontSize: 12,
    fontWeight: 'bold',
  },
  playButton: {
    backgroundColor: '#00ffcc',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  playButtonText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 12,
  },
  fullScreenBtn: {
    backgroundColor: '#1f1f1f',
    borderWidth: 1,
    borderColor: '#333333',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  fullScreenBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  statusText: {
    fontFamily: 'monospace',
    color: '#666666',
    fontWeight: 'bold',
    fontSize: 13,
  },
});
