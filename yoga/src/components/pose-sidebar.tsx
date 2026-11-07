import React from 'react';
import { Platform, StyleSheet, ScrollView, View, TextInput, ActivityIndicator, Modal, Pressable } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

interface PoseSidebarProps {
  poses: any[];
  loadingPoses: boolean;
  selectedPoseId: string | null;
  onSelectPose: (pose: any) => void;
  onDeletePose: (poseId: string, name: string) => Promise<void>;
  showAddDialog: boolean;
  setShowAddDialog: (show: boolean) => void;
  newPoseName: string;
  setNewPoseName: (name: string) => void;
  addingPose: boolean;
  onAddPose: () => Promise<void>;
}

export const PoseSidebar: React.FC<PoseSidebarProps> = ({
  poses,
  loadingPoses,
  selectedPoseId,
  onSelectPose,
  onDeletePose,
  showAddDialog,
  setShowAddDialog,
  newPoseName,
  setNewPoseName,
  addingPose,
  onAddPose,
}) => {
  return (
    <View style={styles.poseSidebar}>
      <View style={styles.sidebarHeader}>
        <ThemedText type="subtitle" style={styles.sidebarTitle}>Poses</ThemedText>
        <Pressable
          onPress={() => setShowAddDialog(true)}
          style={({ pressed }) => [
            styles.addButton,
            pressed && { opacity: 0.8 }
          ]}
        >
          <ThemedText style={styles.addButtonText}>+ New Pose</ThemedText>
        </Pressable>
      </View>

      <View style={styles.divider} />

      <ScrollView style={styles.poseList} showsVerticalScrollIndicator={false}>
        {loadingPoses ? (
          <ActivityIndicator size="small" color="#00ffcc" style={{ marginTop: 16 }} />
        ) : poses.length === 0 ? (
          <ThemedText style={styles.emptyPosesText}>No poses saved yet.</ThemedText>
        ) : (
          poses.map((pose) => {
            const isSelected = selectedPoseId === pose.id;
            return (
              <View
                key={pose.id}
                style={[
                  styles.poseItem,
                  isSelected && styles.poseItemSelected,
                ]}
              >
                <Pressable
                  onPress={() => onSelectPose(pose)}
                  style={({ pressed }) => [
                    { flex: 1, flexDirection: 'row', alignItems: 'center' },
                    pressed && { opacity: 0.7 }
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.poseName,
                      isSelected && styles.poseNameSelected,
                      { flex: 1 }
                    ]}
                    numberOfLines={1}
                  >
                    🧘 {pose.name}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => onDeletePose(pose.id, pose.name)}
                  style={({ pressed }) => [
                    styles.deleteButton,
                    pressed && { opacity: 0.6 }
                  ]}
                >
                  {Platform.OS === 'web' ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#666"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  ) : (
                    <ThemedText style={styles.deleteButtonText}>✕</ThemedText>
                  )}
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Save Pose Dialog Modal */}
      <Modal
        visible={showAddDialog}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setShowAddDialog(false);
          setNewPoseName('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ThemedText type="subtitle" style={styles.modalTitle}>
              Add New Pose
            </ThemedText>
            <ThemedText type="small" style={styles.modalDesc}>
              Enter a name for the current pose skeleton:
            </ThemedText>
            <TextInput
              value={newPoseName}
              onChangeText={setNewPoseName}
              placeholder="e.g. Tree Pose"
              placeholderTextColor="#71717a"
              style={styles.textInput}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setShowAddDialog(false);
                  setNewPoseName('');
                }}
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalButtonCancel,
                  pressed && { opacity: 0.8 }
                ]}
              >
                <ThemedText style={styles.modalButtonCancelText}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={onAddPose}
                disabled={addingPose || !newPoseName.trim()}
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalButtonAdd,
                  (!newPoseName.trim() || addingPose) && { opacity: 0.5 },
                  pressed && { opacity: 0.8 }
                ]}
              >
                <ThemedText style={styles.modalButtonAddText}>
                  {addingPose ? 'Saving...' : 'Save Pose'}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  poseSidebar: {
    width: Platform.OS === 'web' ? 280 : '100%',
    paddingVertical: Spacing.four,
    paddingRight: Spacing.two,
    paddingLeft: 0,
    gap: Spacing.two,
  },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 0,
    marginBottom: Spacing.one,
  },
  sidebarTitle: {
    fontWeight: '600',
  },
  addButton: {
    backgroundColor: '#00ffcc',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 8,
  },
  addButtonText: {
    color: '#000',
    fontSize: 12,
    fontWeight: 'bold',
  },
  divider: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: Spacing.one,
  },
  poseList: {
    flex: 1,
    maxHeight: Platform.OS === 'web' ? 450 : 250,
  },
  poseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: 8,
    marginBottom: Spacing.one,
    backgroundColor: 'rgba(255,255,255,0.03)',
    ...Platform.select({
      web: {
        outlineStyle: 'none' as any,
      }
    })
  },
  poseItemSelected: {
    backgroundColor: 'rgba(0, 255, 204, 0.15)',
    borderWidth: 1,
    borderColor: '#00ffcc',
    ...Platform.select({
      web: {
        outlineStyle: 'none' as any,
      }
    })
  },
  deleteButton: {
    padding: 4,
    marginLeft: Spacing.two,
    borderRadius: 4,
    ...Platform.select({
      web: {
        outlineStyle: 'none' as any,
      }
    })
  },
  deleteButtonText: {
    fontSize: 14,
  },
  poseName: {
    fontSize: 14,
    color: '#ccc',
  },
  poseNameSelected: {
    color: '#00ffcc',
    fontWeight: 'bold',
  },
  emptyPosesText: {
    color: '#666',
    textAlign: 'center',
    marginTop: Spacing.four,
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    padding: Spacing.four,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#33333e',
    backgroundColor: '#18181c',
    gap: Spacing.three,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  modalDesc: {
    color: '#a1a1aa',
    fontSize: 14,
  },
  textInput: {
    width: '100%',
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    color: '#ffffff',
    fontSize: 14,
    ...Platform.select({
      web: {
        outlineStyle: 'none' as any,
      }
    })
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  modalButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  modalButtonCancelText: {
    fontSize: 14,
    color: '#e4e4e7',
    fontWeight: '500',
  },
  modalButtonAdd: {
    backgroundColor: '#00ffcc',
  },
  modalButtonAddText: {
    fontSize: 14,
    color: '#000000',
    fontWeight: 'bold',
  },
});
