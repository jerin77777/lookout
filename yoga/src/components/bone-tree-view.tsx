import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, Platform, ScrollView, Pressable } from 'react-native';
import { ThemedText } from './themed-text';

interface BoneNode {
  name: string;
  children: BoneNode[];
}

interface BoneTreeViewProps {
  /** Ref to the source <model-viewer> element */
  sourceViewerRef: React.RefObject<any>;
  style?: any;
  selectedBoneName: string | null;
  onSelectBone: (name: string | null) => void;
  ikLegsEnabled?: boolean;
  onToggleIkLegs?: () => void;
  ikArmsEnabled?: boolean;
  onToggleIkArms?: () => void;
  symmetricArmsEnabled?: boolean;
  onToggleSymmetricArms?: () => void;
  symmetricLegsEnabled?: boolean;
  onToggleSymmetricLegs?: () => void;
}

import { isArmBone, isLegBone, isRelevantBone, formatBoneName } from '@/utils/pose-utils';

/* ─── helper: build tree from flat bone list ─── */
function buildBoneTree(bones: any[], filterIrrelevant: boolean = true): BoneNode[] {
  const targetBones = filterIrrelevant ? bones.filter((b) => isRelevantBone(b.name)) : bones;
  const boneSet = new Set(targetBones);

  const childrenMap = new Map<any, any[]>();
  targetBones.forEach((b) => childrenMap.set(b, []));

  const roots: any[] = [];

  targetBones.forEach((bone) => {
    let p = bone.parent;
    while (p && p.isBone && !boneSet.has(p)) {
      p = p.parent;
    }

    if (p && p.isBone && boneSet.has(p)) {
      childrenMap.get(p)?.push(bone);
    } else {
      roots.push(bone);
    }
  });

  const toNode = (bone: any): BoneNode => ({
    name: bone.name || '(unnamed)',
    children: (childrenMap.get(bone) || []).map(toNode),
  });

  return roots.map(toNode);
}

interface TreeNodeProps {
  node: BoneNode;
  depth: number;
  selectedBoneName: string | null;
  onSelectBone: (name: string | null) => void;
  symmetricArmsEnabled?: boolean;
  symmetricLegsEnabled?: boolean;
}

function hasSelectedDescendant(node: BoneNode, selectedName: string | null): boolean {
  if (!selectedName) return false;
  return node.children.some(
    (child) => child.name === selectedName || hasSelectedDescendant(child, selectedName)
  );
}

/* ─── single tree row ─── */
const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  depth,
  selectedBoneName,
  onSelectBone,
  symmetricArmsEnabled,
  symmetricLegsEnabled,
}) => {
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(depth < 2); // auto-expand first 2 levels
  const isSelected = selectedBoneName === node.name;
  const rowRef = useRef<any>(null);

  // Auto-expand if a descendant is selected
  useEffect(() => {
    if (selectedBoneName && hasSelectedDescendant(node, selectedBoneName)) {
      setExpanded(true);
    }
  }, [selectedBoneName, node]);

  // Scroll selected bone into view
  useEffect(() => {
    if (isSelected && rowRef.current) {
      const el = rowRef.current;
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
      }
    }
  }, [isSelected]);

  const isArm = node.name ? isArmBone(node.name) : false;
  const isLeg = node.name ? isLegBone(node.name) : false;
  const isDisabled = ((isArm && symmetricArmsEnabled) || (isLeg && symmetricLegsEnabled)) && node.name.includes('_L_');

  return (
    <View>
      <Pressable
        ref={rowRef}
        disabled={isDisabled}
        onPress={() => {
          onSelectBone(node.name);
          if (hasChildren) {
            setExpanded((prev) => !prev);
          }
        }}
        style={({ pressed }: { pressed: boolean }) => [
          styles.row,
          { paddingLeft: 12 + depth * 16 },
          isSelected && styles.rowSelected,
          pressed && !isDisabled && styles.rowPressed,
          isDisabled && { opacity: 0.35 },
        ]}
      >
        {/* chevron / leaf indicator */}
        <ThemedText style={[styles.chevron, !hasChildren && styles.leafDot, isDisabled && { color: '#444' }]}>
          {hasChildren ? (expanded ? '▾' : '▸') : '·'}
        </ThemedText>

        {/* bone name */}
        <ThemedText
          style={[
            styles.boneName,
            !hasChildren && styles.leafName,
            isSelected && styles.boneNameSelected,
          ]}
          numberOfLines={1}
        >
          {formatBoneName(node.name)}
        </ThemedText>

        {/* child count badge */}
        {hasChildren && (
          <View style={styles.badge}>
            <ThemedText style={styles.badgeText}>{node.children.length}</ThemedText>
          </View>
        )}
      </Pressable>

      {/* children */}
      {expanded && node.children.map((child, i) => (
        <TreeNode
          key={`${child.name}-${i}`}
          node={child}
          depth={depth + 1}
          selectedBoneName={selectedBoneName}
          onSelectBone={onSelectBone}
          symmetricArmsEnabled={symmetricArmsEnabled}
          symmetricLegsEnabled={symmetricLegsEnabled}
        />
      ))}
    </View>
  );
};

/* ─── main component ─── */
export const BoneTreeView: React.FC<BoneTreeViewProps> = ({
  sourceViewerRef,
  style,
  selectedBoneName,
  onSelectBone,
  ikLegsEnabled,
  onToggleIkLegs,
  ikArmsEnabled,
  onToggleIkArms,
  symmetricArmsEnabled,
  onToggleSymmetricArms,
  symmetricLegsEnabled,
  onToggleSymmetricLegs,
}) => {
  const [tree, setTree] = useState<BoneNode[]>([]);
  const [totalBoneCount, setTotalBoneCount] = useState(0);
  const [displayedBoneCount, setDisplayedBoneCount] = useState(0);
  const [filterIrrelevant, setFilterIrrelevant] = useState(true);
  const rawBonesRef = useRef<any[]>([]);

  const extractBones = useCallback(() => {
    const viewer = sourceViewerRef.current;
    if (!viewer) return;

    const symbols = Object.getOwnPropertySymbols(viewer);
    const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
    if (!sceneSym) return;

    const scene = viewer[sceneSym];
    if (!scene) return;

    const bones: any[] = [];
    scene.traverse((child: any) => {
      if (child.isBone) bones.push(child);
    });

    if (bones.length > 0 && bones.length !== totalBoneCount) {
      rawBonesRef.current = bones;
      setTotalBoneCount(bones.length);
      const newTree = buildBoneTree(bones, filterIrrelevant);
      setTree(newTree);
      const filteredCount = filterIrrelevant ? bones.filter((b) => isRelevantBone(b.name)).length : bones.length;
      setDisplayedBoneCount(filteredCount);
    }
  }, [sourceViewerRef, totalBoneCount, filterIrrelevant]);

  useEffect(() => {
    if (rawBonesRef.current.length > 0) {
      const newTree = buildBoneTree(rawBonesRef.current, filterIrrelevant);
      setTree(newTree);
      const filteredCount = filterIrrelevant ? rawBonesRef.current.filter((b) => isRelevantBone(b.name)).length : rawBonesRef.current.length;
      setDisplayedBoneCount(filteredCount);
    }
  }, [filterIrrelevant]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    // Poll until bones are available (model might still be loading)
    const interval = setInterval(() => {
      extractBones();
    }, 500);

    return () => clearInterval(interval);
  }, [extractBones]);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  if (Platform.OS !== 'web') {
    return (
      <View style={[styles.container, styles.fallback, style]}>
        <ThemedText type="smallBold">Bone Tree (Web Only)</ThemedText>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {/* header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerDot} />
          <ThemedText style={styles.headerTitle}>Bone Hierarchy</ThemedText>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            onPress={() => setFilterIrrelevant((prev) => !prev)}
            style={({ pressed }) => [
              styles.filterToggle,
              filterIrrelevant && styles.filterToggleActive,
              pressed && { opacity: 0.7 },
            ]}
          >
            <ThemedText style={[styles.filterToggleText, filterIrrelevant && styles.filterToggleTextActive]}>
              {filterIrrelevant ? 'Clean' : 'All'}
            </ThemedText>
          </Pressable>

          {totalBoneCount > 0 && (
            <View style={styles.countBadge}>
              <ThemedText style={styles.countText}>
                {filterIrrelevant ? `${displayedBoneCount}` : `${totalBoneCount}`}
              </ThemedText>
            </View>
          )}
        </View>
      </View>

      {/* separator */}
      <View style={styles.separator} />

      {/* Controls Bar for Symmetry & IK Checkboxes */}
      {(onToggleSymmetricArms || onToggleSymmetricLegs || onToggleIkLegs || onToggleIkArms) && (
        <View style={styles.controlsBar}>
          {onToggleSymmetricArms && (
            <Pressable
              onPress={onToggleSymmetricArms}
              style={({ pressed }) => [
                styles.checkboxToggle,
                symmetricArmsEnabled && styles.checkboxToggleActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={[styles.checkboxBox, symmetricArmsEnabled && styles.checkboxBoxActive]}>
                {symmetricArmsEnabled && <ThemedText style={styles.checkboxCheckmark}>✓</ThemedText>}
              </View>
              <ThemedText style={[styles.checkboxLabel, symmetricArmsEnabled && styles.checkboxLabelActive]}>
                Sym Arms
              </ThemedText>
            </Pressable>
          )}

          {onToggleSymmetricLegs && (
            <Pressable
              onPress={onToggleSymmetricLegs}
              style={({ pressed }) => [
                styles.checkboxToggle,
                symmetricLegsEnabled && styles.checkboxToggleActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={[styles.checkboxBox, symmetricLegsEnabled && styles.checkboxBoxActive]}>
                {symmetricLegsEnabled && <ThemedText style={styles.checkboxCheckmark}>✓</ThemedText>}
              </View>
              <ThemedText style={[styles.checkboxLabel, symmetricLegsEnabled && styles.checkboxLabelActive]}>
                Sym Legs
              </ThemedText>
            </Pressable>
          )}

          {onToggleIkLegs && (
            <Pressable
              onPress={onToggleIkLegs}
              style={({ pressed }) => [
                styles.checkboxToggle,
                ikLegsEnabled && styles.checkboxToggleActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={[styles.checkboxBox, ikLegsEnabled && styles.checkboxBoxActive]}>
                {ikLegsEnabled && <ThemedText style={styles.checkboxCheckmark}>✓</ThemedText>}
              </View>
              <ThemedText style={[styles.checkboxLabel, ikLegsEnabled && styles.checkboxLabelActive]}>
                IK Legs
              </ThemedText>
            </Pressable>
          )}

          {onToggleIkArms && (
            <Pressable
              onPress={onToggleIkArms}
              style={({ pressed }) => [
                styles.checkboxToggle,
                ikArmsEnabled && styles.checkboxToggleActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={[styles.checkboxBox, ikArmsEnabled && styles.checkboxBoxActive]}>
                {ikArmsEnabled && <ThemedText style={styles.checkboxCheckmark}>✓</ThemedText>}
              </View>
              <ThemedText style={[styles.checkboxLabel, ikArmsEnabled && styles.checkboxLabelActive]}>
                IK Arms
              </ThemedText>
            </Pressable>
          )}
        </View>
      )}

      {/* tree content */}
      {tree.length === 0 ? (
        <View style={styles.emptyState}>
          <ThemedText style={styles.emptyIcon}>🦴</ThemedText>
          <ThemedText style={styles.emptyText}>Loading bone data…</ThemedText>
          <ThemedText style={styles.emptyHint}>
            Waiting for the 3D model to finish loading
          </ThemedText>
        </View>
      ) : (
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'auto',
          }}
        >
          <div style={{ minWidth: '100%', width: 'max-content', paddingTop: 6, paddingBottom: 6 }}>
            {tree.map((root, i) => (
              <TreeNode
                key={`${root.name}-${i}`}
                node={root}
                depth={0}
                selectedBoneName={selectedBoneName}
                onSelectBone={onSelectBone}
                symmetricArmsEnabled={!!symmetricArmsEnabled}
                symmetricLegsEnabled={!!symmetricLegsEnabled}
              />
            ))}
          </div>
        </div>
      )}
    </View>
  );
};

/* ─── styles ─── */
const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a0a',
    flex: 1,
    overflow: 'hidden',
    minWidth: 240,
  },
  fallback: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },

  /* header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00ffcc',
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#e0e0e0',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  countBadge: {
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.2)',
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#00ffcc',
  },
  filterToggle: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  } as any,
  filterToggleActive: {
    backgroundColor: 'rgba(0, 255, 204, 0.15)',
    borderColor: 'rgba(0, 255, 204, 0.3)',
  },
  filterToggleText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#888',
  },
  filterToggleTextActive: {
    color: '#00ffcc',
  },

  /* controls bar & checkboxes */
  controlsBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f1f',
  },
  checkboxToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
    }),
  } as any,
  checkboxToggleActive: {
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    borderColor: 'rgba(0, 255, 204, 0.4)',
  },
  checkboxBox: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#666',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  checkboxBoxActive: {
    borderColor: '#00ffcc',
    backgroundColor: '#00ffcc',
  },
  checkboxCheckmark: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#000000',
    lineHeight: 12,
  },
  checkboxLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#aaa',
  },
  checkboxLabelActive: {
    color: '#00ffcc',
  },


  /* separator */
  separator: {
    height: 1,
    backgroundColor: '#1a1a1a',
    marginHorizontal: 0,
  },

  /* scroll area */
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 6,
  },

  /* tree row */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingRight: 12,
    gap: 6,
  },
  rowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  rowSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  chevron: {
    fontSize: 12,
    color: '#00ffcc',
    width: 14,
    textAlign: 'center',
  },
  leafDot: {
    color: '#333',
    fontSize: 16,
  },
  boneName: {
    flex: 1,
    fontSize: 12,
    color: '#c0c0c0',
    fontFamily: 'monospace',
  },
  boneNameSelected: {
    color: '#ffffff',
    fontWeight: '700',
  },
  leafName: {
    color: '#777',
  },
  badge: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 4,
  },
  badgeText: {
    fontSize: 10,
    color: '#666',
    fontWeight: '600',
  },

  /* empty state */
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 8,
  },
  emptyIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 13,
    color: '#888',
    fontWeight: '500',
  },
  emptyHint: {
    fontSize: 11,
    color: '#555',
    textAlign: 'center',
  },
});
