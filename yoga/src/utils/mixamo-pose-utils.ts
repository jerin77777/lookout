/**
 * Apply HybrIK 3D pose to a Mixamo-rigged model (humanMesh6.fbx).
 *
 * This is a SEPARATE implementation from applyHybrIKPoseToModel (which targets
 * CC_Base_* bones on the amber.glb character). This function targets mixamorig:*
 * bones found in the humanMesh6.fbx model.
 *
 * HybrIK joint indices (SMPL 24-joint + extra):
 *   0: pelvis, 1: left_hip, 2: right_hip, 3: spine1,
 *   4: left_knee, 5: right_knee, 6: spine2,
 *   7: left_ankle, 8: right_ankle, 9: spine3,
 *   10: left_foot, 11: right_foot, 12: neck,
 *   13: left_collar, 14: right_collar, 15: head,
 *   16: left_shoulder, 17: right_shoulder,
 *   18: left_elbow, 19: right_elbow,
 *   20: left_wrist, 21: right_wrist,
 *   22: left_hand, 23: right_hand, 24: nose
 *
 * Mixamo skeleton (humanMesh6.fbx):
 *   mixamorig:Hips_01 → Spine_02 → Spine1_03 → Spine2_04
 *     → Neck_05 → Head_06
 *     → LeftShoulder_08 → LeftArm_09 → LeftForeArm_010 → LeftHand_011
 *     → RightShoulder_032 → RightArm_033 → RightForeArm_034 → RightHand_035
 *   mixamorig:Hips_01
 *     → LeftUpLeg_056 → LeftLeg_00 → LeftFoot_057 → LeftToeBase_058
 *     → RightUpLeg_060 → RightLeg_061 → RightFoot_062 → RightToeBase_063
 */

import type { HybrIKResult } from './hybrik-pose-utils';

export const applyHybrIKPoseToMixamoModel = (
  scene: any,
  hybrikResult: HybrIKResult,
  THREE: any
) => {
  if (
    !hybrikResult.success ||
    !hybrikResult.joints_3d ||
    hybrikResult.joints_3d.length === 0
  ) {
    console.warn('[MixamoPose] HybrIK pose data invalid or empty.');
    return;
  }

  // ── 1. Collect bones by name ───────────────────────────────────────────
  const bones: { [name: string]: any } = {};
  scene.traverse((child: any) => {
    if (
      child.isBone ||
      child.type === 'Bone' ||
      (child.name && (
        child.name.toLowerCase().includes('mixamorig') ||
        child.name.toLowerCase().includes('hip') ||
        child.name.toLowerCase().includes('spine') ||
        child.name.toLowerCase().includes('arm') ||
        child.name.toLowerCase().includes('leg')
      ))
    ) {
      bones[child.name] = child;
    }
  });

  // Find bones by normalized matching (handles _01, _02, colons, underscores, case difference)
  const findBone = (query: string): any => {
    if (!query) return null;
    const normQuery = query.toLowerCase().replace(/[:_\s]/g, '');

    // 1. Try exact match
    if (bones[query]) return bones[query];

    // 2. Try normalized substring match
    for (const name of Object.keys(bones)) {
      const normName = name.toLowerCase().replace(/[:_\s]/g, '');
      if (normName.includes(normQuery)) return bones[name];
    }

    // 3. Fallback: try matching without 'mixamorig' prefix
    const strippedQuery = normQuery.replace(/^mixamorig/, '');
    if (strippedQuery && strippedQuery !== normQuery) {
      for (const name of Object.keys(bones)) {
        const normName = name.toLowerCase().replace(/[:_\s]/g, '');
        if (normName.includes(strippedQuery)) return bones[name];
      }
    }

    return null;
  };

  // Mixamo bone references
  const hipBone = findBone('mixamorig:Hips') || findBone('Hips');
  const spineBone = findBone('mixamorig:Spine') || findBone('Spine');
  const spine1Bone = findBone('mixamorig:Spine1') || findBone('Spine1');
  const spine2Bone = findBone('mixamorig:Spine2') || findBone('Spine2');
  const neckBone = findBone('mixamorig:Neck') || findBone('Neck');
  const headBone = findBone('mixamorig:Head') || findBone('Head');

  const leftShoulder = findBone('mixamorig:LeftShoulder') || findBone('LeftShoulder');
  const leftArm = findBone('mixamorig:LeftArm') || findBone('LeftArm');
  const leftForeArm = findBone('mixamorig:LeftForeArm') || findBone('LeftForeArm');
  const leftHand = findBone('mixamorig:LeftHand') || findBone('LeftHand');

  const rightShoulder = findBone('mixamorig:RightShoulder') || findBone('RightShoulder');
  const rightArm = findBone('mixamorig:RightArm') || findBone('RightArm');
  const rightForeArm = findBone('mixamorig:RightForeArm') || findBone('RightForeArm');
  const rightHand = findBone('mixamorig:RightHand') || findBone('RightHand');

  const leftUpLeg = findBone('mixamorig:LeftUpLeg') || findBone('LeftUpLeg');
  const leftLeg = findBone('mixamorig:LeftLeg') || findBone('LeftLeg');
  const leftFoot = findBone('mixamorig:LeftFoot') || findBone('LeftFoot');
  const leftToeBase = findBone('mixamorig:LeftToeBase') || findBone('LeftToeBase');

  const rightUpLeg = findBone('mixamorig:RightUpLeg') || findBone('RightUpLeg');
  const rightLeg = findBone('mixamorig:RightLeg') || findBone('RightLeg');
  const rightFoot = findBone('mixamorig:RightFoot') || findBone('RightFoot');
  const rightToeBase = findBone('mixamorig:RightToeBase') || findBone('RightToeBase');

  if (!hipBone) {
    console.error('[MixamoPose] Cannot find Hips bone. Found nodes:', Object.keys(bones).slice(0, 20).join(', '));
    return;
  }

  // ── 2. Convert HybrIK joints to Three.js world coordinates ────────────
  // HybrIK camera coords: X=right, Y=down, Z=depth away
  // Three.js world coords: X=right, Y=up, Z=towards camera
  const rawJoints = hybrikResult.joints_3d;
  const pts = rawJoints.map((j: number[]) => {
    return new THREE.Vector3(j[0], -j[1], -j[2]);
  });

  // Get model root position for grounding
  const rootWorldPos = new THREE.Vector3();
  if (hipBone.parent) {
    hipBone.parent.getWorldPosition(rootWorldPos);
  }

  // Find lowest point for grounding
  let lowestY = Infinity;
  for (const p of pts) {
    if (p.y < lowestY) lowestY = p.y;
  }

  // Translate so lowest point aligns with root
  const yOffset = rootWorldPos.y - lowestY;
  for (const p of pts) {
    p.y += yOffset;
  }

  // Scale points to roughly match model proportions
  // Compute the hip-to-head height from the pose
  const poseHipMid = pts[0].clone(); // pelvis
  const poseHead = pts[15].clone();
  const poseHeight = poseHead.y - lowestY;

  // Get model's natural height by measuring hip to head distance
  hipBone.updateMatrixWorld(true);
  const hipWorldPos = new THREE.Vector3();
  hipBone.getWorldPosition(hipWorldPos);

  let headWorldPos = new THREE.Vector3();
  if (headBone) {
    headBone.getWorldPosition(headWorldPos);
  } else {
    headWorldPos.copy(hipWorldPos).add(new THREE.Vector3(0, 0.5, 0));
  }

  const modelHeight = headWorldPos.y - rootWorldPos.y;
  const poseScale = modelHeight > 0.01 && poseHeight > 0.01 ? modelHeight / poseHeight : 1.0;

  // Scale and re-center all points
  for (const p of pts) {
    p.sub(poseHipMid);
    p.multiplyScalar(poseScale);
    p.add(hipWorldPos);
  }

  console.log('[MixamoPose] poseScale:', poseScale, 'modelHeight:', modelHeight, 'poseHeight:', poseHeight);

  // ── 3. Helper: Get landmark point ─────────────────────────────────────
  const getLM = (idx: number) => pts[idx] || new THREE.Vector3(0, 0, 0);
  const mid = (a: any, b: any) => a.clone().add(b).multiplyScalar(0.5);

  // Named HybrIK landmarks
  const lmLeftHip = getLM(1);
  const lmRightHip = getLM(2);
  const lmSpine1 = getLM(3);
  const lmLeftKnee = getLM(4);
  const lmRightKnee = getLM(5);
  const lmSpine2 = getLM(6);
  const lmLeftAnkle = getLM(7);
  const lmRightAnkle = getLM(8);
  const lmSpine3 = getLM(9);
  const lmLeftFoot = getLM(10);
  const lmRightFoot = getLM(11);
  const lmNeck = getLM(12);
  const lmHead = getLM(15);
  const lmLeftShoulder = getLM(16);
  const lmRightShoulder = getLM(17);
  const lmLeftElbow = getLM(18);
  const lmRightElbow = getLM(19);
  const lmLeftWrist = getLM(20);
  const lmRightWrist = getLM(21);

  const hipMid = mid(lmLeftHip, lmRightHip);
  const shoulderMid = mid(lmLeftShoulder, lmRightShoulder);

  // ── 4. Align bone helper ──────────────────────────────────────────────
  // Rotates `bone` so that its child points from `fromWorld` toward `toWorld`
  const alignBone = (bone: any, child: any, fromWorld: any, toWorld: any) => {
    if (!bone || !child) return;

    bone.updateMatrixWorld(true);

    const targetWorldDir = new THREE.Vector3()
      .subVectors(toWorld, fromWorld)
      .normalize();
    const childLocalDir = child.position.clone().normalize();
    const childDirInParent = childLocalDir
      .clone()
      .applyQuaternion(bone.quaternion)
      .normalize();

    const parentWorldQuat = new THREE.Quaternion();
    if (bone.parent) bone.parent.getWorldQuaternion(parentWorldQuat);
    const targetInParent = targetWorldDir
      .clone()
      .applyQuaternion(parentWorldQuat.clone().invert())
      .normalize();

    const rotationDelta = new THREE.Quaternion().setFromUnitVectors(
      childDirInParent,
      targetInParent
    );
    bone.quaternion.premultiply(rotationDelta);
    bone.updateMatrixWorld(true);
  };

  // ── 5. Hip orientation (full frame alignment) ─────────────────────────
  // Save default hip position for later grounding
  const defaultHipPos = hipBone.position.clone();

  if (hipBone && spineBone && leftUpLeg) {
    hipBone.position.copy(defaultHipPos);
    hipBone.updateMatrixWorld(true);

    // Rest frame: spine direction and lateral from left thigh
    const restSpine = spineBone.position.clone().normalize();
    const restLateral = leftUpLeg.position.clone();
    restLateral
      .sub(restSpine.clone().multiplyScalar(restLateral.dot(restSpine)))
      .normalize();
    const restFwd = new THREE.Vector3()
      .crossVectors(restLateral, restSpine)
      .normalize();
    restLateral.crossVectors(restSpine, restFwd).normalize();

    // Target frame from HybrIK landmarks
    const targetSpine = new THREE.Vector3()
      .subVectors(shoulderMid, hipMid)
      .normalize();
    const targetLateral = new THREE.Vector3().subVectors(
      lmLeftHip,
      lmRightHip
    );
    targetLateral
      .sub(
        targetSpine
          .clone()
          .multiplyScalar(targetLateral.dot(targetSpine))
      )
      .normalize();
    const targetFwd = new THREE.Vector3()
      .crossVectors(targetLateral, targetSpine)
      .normalize();
    targetLateral.crossVectors(targetSpine, targetFwd).normalize();

    // Transform into hip's parent space
    const parentQuat = new THREE.Quaternion();
    if (hipBone.parent) hipBone.parent.getWorldQuaternion(parentQuat);
    const invParent = parentQuat.clone().invert();

    const tSpineLocal = targetSpine.clone().applyQuaternion(invParent);
    const tLateralLocal = targetLateral.clone().applyQuaternion(invParent);
    const tFwdLocal = targetFwd.clone().applyQuaternion(invParent);

    const restMat = new THREE.Matrix4().makeBasis(
      restLateral,
      restSpine,
      restFwd
    );
    const targetMat = new THREE.Matrix4().makeBasis(
      tLateralLocal,
      tSpineLocal,
      tFwdLocal
    );
    const hipRotMat = targetMat.clone().multiply(restMat.clone().invert());

    hipBone.quaternion.setFromRotationMatrix(hipRotMat);
    hipBone.updateMatrixWorld(true);
  }

  // ── 6. Spine chain ────────────────────────────────────────────────────
  alignBone(spineBone, spine1Bone, hipMid, lmSpine1);
  alignBone(spine1Bone, spine2Bone, lmSpine1, lmSpine2);
  alignBone(spine2Bone, neckBone, lmSpine2, lmNeck);

  // ── 7. Arms ───────────────────────────────────────────────────────────
  // Left arm
  alignBone(leftShoulder, leftArm, shoulderMid, lmLeftShoulder);
  alignBone(leftArm, leftForeArm, lmLeftShoulder, lmLeftElbow);
  alignBone(leftForeArm, leftHand, lmLeftElbow, lmLeftWrist);

  // Right arm
  alignBone(rightShoulder, rightArm, shoulderMid, lmRightShoulder);
  alignBone(rightArm, rightForeArm, lmRightShoulder, lmRightElbow);
  alignBone(rightForeArm, rightHand, lmRightElbow, lmRightWrist);

  // ── 8. Legs ───────────────────────────────────────────────────────────
  // Left leg
  alignBone(leftUpLeg, leftLeg, lmLeftHip, lmLeftKnee);
  alignBone(leftLeg, leftFoot, lmLeftKnee, lmLeftAnkle);
  alignBone(leftFoot, leftToeBase, lmLeftAnkle, lmLeftFoot);

  // Right leg
  alignBone(rightUpLeg, rightLeg, lmRightHip, lmRightKnee);
  alignBone(rightLeg, rightFoot, lmRightKnee, lmRightAnkle);
  alignBone(rightFoot, rightToeBase, lmRightAnkle, lmRightFoot);

  // ── 9. Neck / Head ────────────────────────────────────────────────────
  const headTarget =
    lmHead.lengthSq() > 0 ? lmHead : lmNeck.clone().add(new THREE.Vector3(0, 0.1, 0));
  alignBone(neckBone, headBone, lmNeck, headTarget);

  scene.updateMatrixWorld(true);

  // ── 10. Ground adjustment ─────────────────────────────────────────────
  // Move hip so lowest bone touches the floor (rootWorldPos.y)
  let lowestBoneY = Infinity;
  scene.traverse((child: any) => {
    if (child.isBone && !child.name.includes('_rootJoint')) {
      const wp = new THREE.Vector3();
      child.getWorldPosition(wp);
      if (wp.y < lowestBoneY) {
        lowestBoneY = wp.y;
      }
    }
  });

  if (lowestBoneY !== Infinity && hipBone && hipBone.parent) {
    const diffY = rootWorldPos.y - lowestBoneY;
    const hipWP = new THREE.Vector3();
    hipBone.getWorldPosition(hipWP);
    hipWP.x = rootWorldPos.x;
    hipWP.z = rootWorldPos.z;
    hipWP.y += diffY;
    hipBone.parent.worldToLocal(hipWP);
    hipBone.position.copy(hipWP);
    hipBone.updateMatrixWorld(true);
  }

  console.log('[MixamoPose] Pose applied to Mixamo model successfully.');
};
