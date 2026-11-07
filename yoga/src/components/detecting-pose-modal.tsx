import React from 'react';
import { Modal, View, ActivityIndicator } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { styles } from '@/app/index.styles';

interface DetectingPoseModalProps {
  visible: boolean;
}

export function DetectingPoseModal({ visible }: DetectingPoseModalProps) {
  return (
    <Modal visible={visible} transparent={true} animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <ActivityIndicator size="large" color="#00ffcc" />
          <ThemedText type="subtitle" style={[styles.modalTitle, { textAlign: 'center', marginTop: 16 }]}>
            Detecting Pose...
          </ThemedText>
          <ThemedText type="small" style={{ color: '#aaa', textAlign: 'center' }}>
            HyBR-IK AI is analyzing the image to map 3D pose landmarks to the character's skeleton.
          </ThemedText>
        </View>
      </View>
    </Modal>
  );
}
