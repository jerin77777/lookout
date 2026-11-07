import { Platform } from 'react-native';

// Dynamic script loader for MediaPipe Pose
export const loadMediaPipePose = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    if ((window as any).Pose) {
      resolve((window as any).Pose);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js';
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      if ((window as any).Pose) {
        resolve((window as any).Pose);
      } else {
        reject(new Error('MediaPipe Pose script loaded but window.Pose not found'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load MediaPipe Pose script'));
    document.head.appendChild(script);
  });
};

export const selectImageFile = (): Promise<string | null> => {
  return new Promise((resolve) => {
    if (Platform.OS !== 'web') {
      resolve(null);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        resolve(event.target?.result as string);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
};

export const applyPoseToModel = (scene: any, landmarks: any, THREE: any) => {
  // Collect all bones from scene
  const bones: { [name: string]: any } = {};
  scene.traverse((child: any) => {
    if (child.isBone) bones[child.name] = child;
  });

  const boneRoot = bones['CC_Base_BoneRoot'] || bones['CS_Base_BoneRoot'];
  const rootPos = new THREE.Vector3(0, 0, 0);
  if (boneRoot) {
    boneRoot.getWorldPosition(rootPos);
  }

  const hipBone = bones['CC_Base_Hip'] || bones['CS_Base_hip'];
  const defaultHipPos = new THREE.Vector3(0, 0.95, 0);
  if (hipBone) {
    defaultHipPos.copy(hipBone.position);
  }

  // Scale and transform landmarks following open-pose-editor convention (helper.ts:55-60):
  // x * 100, -y * 100, -z * 100
  const pts = landmarks.map((pt: any) => {
    if (!pt) return new THREE.Vector3(0, 0, 0);
    return new THREE.Vector3(pt.x * 100, -pt.y * 100, -pt.z * 100);
  });

  // Find the lowest point (minimum Y coordinate in Three.js space)
  let lowestPt = pts[0]?.clone() || new THREE.Vector3(0, 0, 0);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y < lowestPt.y) {
      lowestPt.copy(pts[i]);
    }
  }

  // Translate all points such that the lowest point is the same as CC_Base_BoneRoot
  const rootPosLandmark = rootPos.clone().multiplyScalar(100);
  const translation = new THREE.Vector3().subVectors(rootPosLandmark, lowestPt);
  for (let i = 0; i < pts.length; i++) {
    pts[i].add(translation);
  }

  console.log('[Pose Debug] rootPos:', rootPos.toArray());
  console.log('[Pose Debug] lowestPt:', lowestPt.toArray());
  console.log('[Pose Debug] translation:', translation.toArray());

  const getLM = (idx: number) => {
    return pts[idx] || new THREE.Vector3(0, 0, 0);
  };

  const mid = (a: any, b: any) => a.clone().add(b).multiplyScalar(0.5);

  // Extract named landmarks (BlazePose indices from defines.ts)
  const nose = getLM(0);
  const leftShoulder = getLM(11);
  const rightShoulder = getLM(12);
  const leftElbow = getLM(13);
  const rightElbow = getLM(14);
  const leftWrist = getLM(15);
  const rightWrist = getLM(16);
  const leftIndex = getLM(19);
  const rightIndex = getLM(20);
  const leftHip = getLM(23);
  const rightHip = getLM(24);
  const leftKnee = getLM(25);
  const rightKnee = getLM(26);
  const leftAnkle = getLM(27);
  const rightAnkle = getLM(28);
  const leftFootIndex = getLM(31);
  const rightFootIndex = getLM(32);

  const hipMid = mid(leftHip, rightHip);
  const shoulderMid = mid(leftShoulder, rightShoulder);

  console.log('[Pose] Landmarks (scaled ×100, Y/Z negated):');
  console.log('  hipMid:', hipMid.toArray(), 'shoulderMid:', shoulderMid.toArray());

  /**
   * Aligns 'boneName' so its child 'childName' points from fromWorld toward toWorld.
   */
  const alignBone = (boneName: string, childName: string, fromWorld: any, toWorld: any) => {
    if (!isCleanBone(boneName)) return;
    const bone = bones[boneName];
    const child = bones[childName];
    if (!bone || !child) return;

    bone.updateMatrixWorld(true);

    // Target direction in world space
    const targetWorldDir = new THREE.Vector3().subVectors(toWorld, fromWorld).normalize();

    // Child's current direction in bone's parent's local space
    // bone.quaternion maps bone-local → parent-local
    const childLocalDir = child.position.clone().normalize();
    const childDirInParent = childLocalDir.clone().applyQuaternion(bone.quaternion).normalize();

    // Convert target direction to bone's parent's local space
    const parentWorldQuat = new THREE.Quaternion();
    if (bone.parent) bone.parent.getWorldQuaternion(parentWorldQuat);
    const targetInParent = targetWorldDir.clone()
      .applyQuaternion(parentWorldQuat.clone().invert()).normalize();

    // Delta rotation: rotates current child direction → target direction (both in parent-local)
    const delta = new THREE.Quaternion().setFromUnitVectors(childDirInParent, targetInParent);

    // Apply: Q_new = delta * Q_current  (preserves rest orientation + twist)
    bone.quaternion.premultiply(delta);
    bone.updateMatrixWorld(true);
  };

  // === Process bones root → outward (order matters for cascading transforms) ===

  // 1. Hip — full orientation via coordinate frame derived from rest-pose children
  //    This handles BOTH direction (lean) AND twist (which way hips face)
  const waistBone = bones['CC_Base_Waist'];
  const lThighBone = bones['CC_Base_L_Thigh'];

  if (hipBone && waistBone && lThighBone) {
    // Keep default horizontal position, Y will be computed at the end of the alignment
    hipBone.position.x = defaultHipPos.x;
    hipBone.position.z = defaultHipPos.z;
    hipBone.position.y = defaultHipPos.y;
    hipBone.updateMatrixWorld(true);

    // Rest-pose coordinate frame in hip's LOCAL space (from children positions)
    const restSpine = waistBone.position.clone().normalize();
    const restLateral = lThighBone.position.clone();
    // Project out spine component to get pure lateral direction
    restLateral.sub(restSpine.clone().multiplyScalar(restLateral.dot(restSpine))).normalize();
    const restFwd = new THREE.Vector3().crossVectors(restLateral, restSpine).normalize();
    restLateral.crossVectors(restSpine, restFwd).normalize(); // re-orthogonalize

    // Target coordinate frame in WORLD space (from detected landmarks)
    const targetSpine = new THREE.Vector3().subVectors(shoulderMid, hipMid).normalize();
    const targetLateral = new THREE.Vector3().subVectors(leftHip, rightHip);
    // Project out spine component for pure lateral
    targetLateral.sub(targetSpine.clone().multiplyScalar(targetLateral.dot(targetSpine))).normalize();
    const targetFwd = new THREE.Vector3().crossVectors(targetLateral, targetSpine).normalize();
    targetLateral.crossVectors(targetSpine, targetFwd).normalize(); // re-orthogonalize

    // Convert target frame to hip's parent's local space
    const parentQuat = new THREE.Quaternion();
    if (hipBone.parent) hipBone.parent.getWorldQuaternion(parentQuat);
    const invParent = parentQuat.clone().invert();

    const tSpineLocal = targetSpine.clone().applyQuaternion(invParent);
    const tLateralLocal = targetLateral.clone().applyQuaternion(invParent);
    const tFwdLocal = targetFwd.clone().applyQuaternion(invParent);

    // Q_hip maps hip-local → parent-local
    // Q_hip * restAxis = targetAxis_parentLocal
    // Therefore: Q_hip = targetMat * inverse(restMat)
    const restMat = new THREE.Matrix4().makeBasis(restLateral, restSpine, restFwd);
    const targetMat = new THREE.Matrix4().makeBasis(tLateralLocal, tSpineLocal, tFwdLocal);
    const hipRotMat = targetMat.clone().multiply(restMat.clone().invert());

    hipBone.quaternion.setFromRotationMatrix(hipRotMat);
    hipBone.updateMatrixWorld(true);

    console.log('[Pose] Hip aligned via coordinate frame');
  }

  // 2. Spine (hip → waist → spine01 → spine02)
  alignBone('CC_Base_Waist', 'CC_Base_Spine01', hipMid, shoulderMid);
  alignBone('CC_Base_Spine01', 'CC_Base_Spine02', hipMid, shoulderMid);

  // 3. Left arm (clavicle → upperarm → forearm → hand)
  alignBone('CC_Base_L_Clavicle', 'CC_Base_L_Upperarm', shoulderMid, leftShoulder);
  alignBone('CC_Base_L_Upperarm', 'CC_Base_L_Forearm', leftShoulder, leftElbow);
  alignBone('CC_Base_L_Forearm', 'CC_Base_L_Hand', leftElbow, leftWrist);

  // 4. Right arm
  alignBone('CC_Base_R_Clavicle', 'CC_Base_R_Upperarm', shoulderMid, rightShoulder);
  alignBone('CC_Base_R_Upperarm', 'CC_Base_R_Forearm', rightShoulder, rightElbow);
  alignBone('CC_Base_R_Forearm', 'CC_Base_R_Hand', rightElbow, rightWrist);

  // 5. Left leg
  alignBone('CC_Base_L_Thigh', 'CC_Base_L_Calf', leftHip, leftKnee);
  alignBone('CC_Base_L_Calf', 'CC_Base_L_Foot', leftKnee, leftAnkle);
  alignBone('CC_Base_L_Foot', 'CC_Base_L_ToeBase', leftAnkle, leftFootIndex);

  // 6. Right leg
  alignBone('CC_Base_R_Thigh', 'CC_Base_R_Calf', rightHip, rightKnee);
  alignBone('CC_Base_R_Calf', 'CC_Base_R_Foot', rightKnee, rightAnkle);
  alignBone('CC_Base_R_Foot', 'CC_Base_R_ToeBase', rightAnkle, rightFootIndex);

  // 7. Neck / Head
  alignBone('CC_Base_NeckTwist01', 'CC_Base_Head', shoulderMid, nose);

  // Update matrix world to reflect aligned bone transforms
  scene.updateMatrixWorld(true);

  // Find the lowest bone in the skeleton relative to rootPos
  let lowestBoneY = Infinity;
  let lowestBoneName = '';
  scene.traverse((child: any) => {
    if (child.isBone && child.name !== 'CC_Base_BoneRoot' && child.name !== 'CS_Base_BoneRoot') {
      const boneWorldPos = new THREE.Vector3();
      child.getWorldPosition(boneWorldPos);
      if (boneWorldPos.y < lowestBoneY) {
        lowestBoneY = boneWorldPos.y;
        lowestBoneName = child.name;
      }
    }
  });

  console.log('[Pose Debug] lowestBoneName:', lowestBoneName, 'lowestBoneY:', lowestBoneY);

  if (lowestBoneY !== Infinity && hipBone && hipBone.parent) {
    const diffY = rootPos.y - lowestBoneY;

    // Get the current world position of the hip bone
    const hipWorldPos = new THREE.Vector3();
    hipBone.getWorldPosition(hipWorldPos);

    // Center it horizontally relative to CC_Base_BoneRoot
    hipWorldPos.x = rootPos.x;
    hipWorldPos.z = rootPos.z;

    // Shift vertically to ensure the lowest bone is at the root bone's Y position
    hipWorldPos.y += diffY;

    // Convert back to parent's local coordinate space
    hipBone.parent.worldToLocal(hipWorldPos);
    hipBone.position.copy(hipWorldPos);

    hipBone.updateMatrixWorld(true);
    console.log('[Pose Debug] Adjusted hip world Y by:', diffY, 'New hip local position:', hipBone.position.toArray());
  }

  console.log('[Pose] All bones aligned');
};

export const getBoneFleshRadius = (boneName: string): number => {
  const name = boneName.toLowerCase();
  if (name.includes('head')) return 0.14;
  if (name.includes('neck')) return 0.08;
  if (name.includes('hip') || name.includes('pelvis')) return 0.14;
  if (name.includes('waist') || name.includes('spine') || name.includes('chest')) return 0.13;
  if (name.includes('thigh')) return 0.11;
  if (name.includes('calf') || name.includes('shin')) return 0.08;
  if (name.includes('foot') || name.includes('heel')) return 0.05;
  if (name.includes('toe')) return 0.03;
  if (name.includes('upperarm') || name.includes('shoulder')) return 0.07;
  if (name.includes('forearm')) return 0.06;
  if (name.includes('hand') || name.includes('finger') || name.includes('wrist')) return 0.04;
  return 0.06; // default fallback radius
};

export const getCounterpartBoneName = (name: string): string | null => {
  if (name.includes('_R_')) {
    return name.replace('_R_', '_L_');
  }
  if (name.includes('_L_')) {
    return name.replace('_L_', '_R_');
  }
  return null;
};

export const isArmBone = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    lower.includes('upperarm') ||
    lower.includes('shoulder') ||
    lower.includes('forearm') ||
    lower.includes('hand') ||
    lower.includes('finger') ||
    lower.includes('wrist') ||
    lower.includes('clavicle') ||
    lower.includes('arm') ||
    lower.includes('elbow') ||
    lower.includes('thumb') ||
    lower.includes('index') ||
    lower.includes('mid') ||
    lower.includes('ring') ||
    lower.includes('pinky')
  );
};

export const isLegBone = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    lower.includes('thigh') ||
    lower.includes('calf') ||
    lower.includes('shin') ||
    lower.includes('foot') ||
    lower.includes('heel') ||
    lower.includes('toe') ||
    lower.includes('knee') ||
    lower.includes('upleg') ||
    lower.includes('leg')
  );
};

export const CLEAN_BONES: string[] = [
  'CC_Base_BoneRoot',
  'CC_Base_Hip',
  'CC_Base_Pelvis',
  'CC_Base_L_Thigh',
  'CC_Base_L_Calf',
  'CC_Base_L_Foot',
  'CC_Base_L_ToeBase',
  'CC_Base_L_PinkyToe1',
  'CC_Base_L_RingToe1',
  'CC_Base_L_MidToe1',
  'CC_Base_L_IndexToe1',
  'CC_Base_L_BigToe1',
  'CC_Base_R_Thigh',
  'CC_Base_R_Calf',
  'CC_Base_R_Foot',
  'CC_Base_R_ToeBase',
  'CC_Base_R_BigToe1',
  'CC_Base_R_PinkyToe1',
  'CC_Base_R_RingToe1',
  'CC_Base_R_IndexToe1',
  'CC_Base_R_MidToe1',
  'CC_Base_Waist',
  'CC_Base_Spine01',
  'CC_Base_Spine02',
  'CC_Base_Head',
  'CC_Base_L_Clavicle',
  'CC_Base_L_Upperarm',
  'CC_Base_L_Forearm',
  'CC_Base_L_Hand',
  'CC_Base_L_Pinky1',
  'CC_Base_L_Pinky2',
  'CC_Base_L_Pinky3',
  'CC_Base_L_Ring1',
  'CC_Base_L_Ring2',
  'CC_Base_L_Ring3',
  'CC_Base_L_Mid1',
  'CC_Base_L_Mid2',
  'CC_Base_L_Mid3',
  'CC_Base_L_Index1',
  'CC_Base_L_Index2',
  'CC_Base_L_Index3',
  'CC_Base_L_Thumb1',
  'CC_Base_L_Thumb2',
  'CC_Base_L_Thumb3',
  'CC_Base_R_Clavicle',
  'CC_Base_R_Upperarm',
  'CC_Base_R_Forearm',
  'CC_Base_R_Hand',
  'CC_Base_R_Ring1',
  'CC_Base_R_Ring2',
  'CC_Base_R_Ring3',
  'CC_Base_R_Mid1',
  'CC_Base_R_Mid2',
  'CC_Base_R_Mid3',
  'CC_Base_R_Thumb1',
  'CC_Base_R_Thumb2',
  'CC_Base_R_Thumb3',
  'CC_Base_R_Index1',
  'CC_Base_R_Index2',
  'CC_Base_R_Index3',
  'CC_Base_R_Pinky1',
  'CC_Base_R_Pinky2',
  'CC_Base_R_Pinky3',
];

const CLEAN_BONES_SET = new Set(CLEAN_BONES);
console.log(`[Clean Bones] Registered ${CLEAN_BONES.length} clean bones explicitly:`, CLEAN_BONES);

export const isCleanBone = (name: string): boolean => {
  if (!name) return false;
  if (CLEAN_BONES_SET.has(name)) return true;
  const ccName = name.replace(/^CS_/, 'CC_');
  return CLEAN_BONES_SET.has(ccName);
};

export const isRelevantBone = (name: string): boolean => {
  return isCleanBone(name);
};

export const isHingeBone = (name: string | null): boolean => {
  if (!name) return false;
  const lower = name.toLowerCase();
  return (
    lower.includes('forearm') ||
    lower.includes('elbow') ||
    lower.includes('calf') ||
    lower.includes('shin') ||
    lower.includes('knee')
  );
};

export const formatBoneName = (name: string): string => {
  if (!name) return '';
  let clean = name.replace(/^(CC_Base_|CS_Base_|CC_|CS_)/, '');

  let prefix = '';
  if (clean.includes('_L_') || clean.startsWith('L_')) {
    prefix = 'Left ';
    clean = clean.replace(/^_?L_?/, '');
  } else if (clean.includes('_R_') || clean.startsWith('R_')) {
    prefix = 'Right ';
    clean = clean.replace(/^_?R_?/, '');
  }

  clean = clean.replace(/^_+|_+$/g, '');

  const mappings: { [key: string]: string } = {
    BoneRoot: 'Root',
    Hip: 'Hip',
    Pelvis: 'Pelvis',
    Waist: 'Waist',
    Spine01: 'Spine 1',
    Spine02: 'Spine 2',
    Spine03: 'Spine 3',
    Head: 'Head',
    Neck: 'Neck',
    NeckTwist01: 'Neck 1',
    NeckTwist02: 'Neck 2',
    Upperarm: 'Upper Arm',
    Forearm: 'Forearm',
    Hand: 'Hand',
    Thigh: 'Thigh',
    Calf: 'Calf',
    Foot: 'Foot',
    ToeBase: 'Toe Base',
    Toe: 'Toe',
    Clavicle: 'Shoulder',
  };

  if (mappings[clean]) {
    return prefix + mappings[clean];
  }

  clean = clean
    .replace(/([a-zA-Z])(\d+)/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2');

  return prefix + clean;
};

export const parseCoords = (text: string): { x: number; y: number; z: number } | null => {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    const jsonStr = trimmed.startsWith('{') ? trimmed : `{${trimmed}}`;
    const parsed = JSON.parse(jsonStr);
    if (parsed) {
      const pitch = typeof parsed.pitch === 'number' ? parsed.pitch : (typeof parsed.x === 'number' ? parsed.x : null);
      const yaw = typeof parsed.yaw === 'number' ? parsed.yaw : (typeof parsed.z === 'number' ? parsed.z : null);
      const roll = typeof parsed.roll === 'number' ? parsed.roll : (typeof parsed.y === 'number' ? parsed.y : null);
      if (pitch !== null && yaw !== null && roll !== null) {
        return { x: pitch, y: roll, z: yaw };
      }
    }
  } catch (e) {}

  const numRegex = /[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/g;
  const matches = trimmed.match(numRegex);
  if (matches && matches.length >= 3) {
    const x = parseFloat(matches[0]);
    const y = parseFloat(matches[1]);
    const z = parseFloat(matches[2]);
    if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
      return { x, y, z };
    }
  }
  return null;
};

export const getCleanBoneRotationsJson = (scene: any): string => {
  if (!scene) return '{}';
  const rotations: { [name: string]: { pitch: number; yaw: number; roll: number } } = {};
  const radToDeg = (rad: number) => Math.round((rad * 180) / Math.PI);

  scene.traverse((child: any) => {
    if (child.isBone && isRelevantBone(child.name)) {
      rotations[child.name] = {
        pitch: radToDeg(child.rotation.x),
        yaw: radToDeg(child.rotation.z),
        roll: radToDeg(child.rotation.y),
      };
    }
  });

  return JSON.stringify(rotations, null, 2);
};

export const applyCleanBoneRotationsJson = (
  scene: any,
  jsonText: string
): { appliedCount: number; error?: string } => {
  if (!scene) return { appliedCount: 0, error: '3D scene not loaded' };
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText.trim());
  } catch (e: any) {
    return { appliedCount: 0, error: 'Invalid JSON format' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { appliedCount: 0, error: 'JSON must be an object or array' };
  }

  const degToRad = (deg: number) => (deg * Math.PI) / 180;
  let appliedCount = 0;

  const boneMap = new Map<string, any>();
  scene.traverse((child: any) => {
    if (child.isBone) {
      boneMap.set(child.name, child);
      boneMap.set(child.name.toLowerCase(), child);
    }
  });

  const applyToBone = (boneObj: any, rotData: any) => {
    if (!boneObj || !rotData) return false;
    let pitch: number | null = null;
    let yaw: number | null = null;
    let roll: number | null = null;

    if (typeof rotData.pitch === 'number') pitch = rotData.pitch;
    else if (typeof rotData.x === 'number') pitch = rotData.x;

    if (typeof rotData.yaw === 'number') yaw = rotData.yaw;
    else if (typeof rotData.z === 'number') yaw = rotData.z;

    if (typeof rotData.roll === 'number') roll = rotData.roll;
    else if (typeof rotData.y === 'number') roll = rotData.y;

    if (pitch !== null) boneObj.rotation.x = degToRad(pitch);
    if (yaw !== null) boneObj.rotation.z = degToRad(yaw);
    if (roll !== null) boneObj.rotation.y = degToRad(roll);

    boneObj.updateMatrixWorld(true);
    return true;
  };

  if (Array.isArray(parsed)) {
    parsed.forEach((item) => {
      if (item && item.name) {
        const bone = boneMap.get(item.name) || boneMap.get(item.name.toLowerCase());
        const rotData = item.rotation || item;
        if (bone && applyToBone(bone, rotData)) {
          appliedCount++;
        }
      }
    });
  } else {
    Object.keys(parsed).forEach((key) => {
      const bone = boneMap.get(key) || boneMap.get(key.toLowerCase());
      const rotData = parsed[key];
      if (bone && applyToBone(bone, rotData)) {
        appliedCount++;
      }
    });
  }

  scene.updateMatrixWorld(true);
  return { appliedCount };
};
