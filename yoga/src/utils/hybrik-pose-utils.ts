import { arriClient, BACKEND_URL } from '../services/client';
import { CLEAN_BONES, isCleanBone } from './pose-utils';

export const HYBRIK_SERVER_URL = BACKEND_URL;
export const HYBRIK_WS_URL = BACKEND_URL.replace(/^http/, 'ws') + '/ws/infer';

export interface HybrIKResult {
  success: boolean;
  message?: string;
  process_time_ms?: number;
  bbox?: number[];
  joint_names?: string[];
  joints_3d?: number[][];
  joints_2d?: number[][];
  body_pose?: number[];
  betas?: number[];
  camera?: number[];
}

export const checkHybrIKServerStatus = async (): Promise<{ online: boolean; detail?: any }> => {
  try {
    const res = await arriClient.ai.hybrikHealth({});
    return { online: res.status === 'ok', detail: res };
  } catch (e) {
    try {
      const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        return { online: data.status === 'ok', detail: data };
      }
    } catch (err) {}
  }
  return { online: false };
};

export const inferBase64Image = async (base64Str: string): Promise<HybrIKResult> => {
  try {
    const res = await arriClient.ai.hybrikInfer({ image: base64Str });
    return {
      success: res.success,
      message: res.message ?? undefined,
      process_time_ms: res.processTimeMs ?? undefined,
      bbox: res.bbox ?? undefined,
      joint_names: res.jointNames ?? undefined,
      joints_3d: res.joints3d ?? undefined,
      joints_2d: res.joints2d ?? undefined,
      body_pose: res.bodyPose ?? undefined,
      betas: res.betas ?? undefined,
      camera: res.camera ?? undefined,
    };
  } catch (e: any) {
    console.error('Arri RPC hybrikInfer error:', e);
    throw new Error(e.message || 'Inference failed');
  }
};

export const inferImageFile = async (file: File | Blob): Promise<HybrIKResult> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const base64Str = e.target?.result as string;
        const res = await inferBase64Image(base64Str);
        resolve(res);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
};

export class HybrIKStreamer {
  private ws: WebSocket | null = null;
  private onResultCallback: (result: HybrIKResult) => void;

  constructor(onResult: (result: HybrIKResult) => void) {
    this.onResultCallback = onResult;
  }

  connect() {
    this.ws = new WebSocket(HYBRIK_WS_URL);
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onResultCallback(data);
      } catch (err) {
        console.error('Failed to parse WS message', err);
      }
    };
    this.ws.onerror = (err) => {
      console.error('HybrIK WebSocket error', err);
    };
  }

  sendFrame(base64Frame: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(base64Frame);
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const getHardcodedCatPoseImageBase64 = async (): Promise<string> => {
  const response = await fetch('/cat_pose.jpg');
  if (!response.ok) {
    throw new Error(`Failed to fetch /cat_pose.jpg: ${response.statusText}`);
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * Apply 3D predicted HybrIK pose to Three.js character model bones
 */
export const applyHybrIKPoseToModel = (scene: any, hybrikResult: HybrIKResult, THREE: any) => {
  if (!hybrikResult.success || !hybrikResult.joints_3d || hybrikResult.joints_3d.length === 0) {
    console.warn('HybrIK pose data invalid or empty.');
    return;
  }

  console.log(`[HybrIK Pose] Applying pose detection targeting ${CLEAN_BONES.length} clean bones:`, CLEAN_BONES);

  // Map of bones in the model
  const bones: { [name: string]: any } = {};
  scene.traverse((child: any) => {
    if (child.isBone) {
      bones[child.name] = child;
    }
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

  const rawJoints = hybrikResult.joints_3d;

  // Convert HybrIK camera coordinates (X=right, Y=down, Z=depth away) to Three.js world coordinates
  const pts = rawJoints.map((j: number[]) => {
    return new THREE.Vector3(j[0] * 100, -j[1] * 100, -j[2] * 100);
  });

  let lowestPt = pts[0]?.clone() || new THREE.Vector3(0, 0, 0);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y < lowestPt.y) {
      lowestPt.copy(pts[i]);
    }
  }

  const rootPosScaled = rootPos.clone().multiplyScalar(100);
  const translation = new THREE.Vector3().subVectors(rootPosScaled, lowestPt);
  for (let i = 0; i < pts.length; i++) {
    pts[i].add(translation);
  }

  const getLM = (idx: number) => pts[idx] || new THREE.Vector3(0, 0, 0);
  const mid = (a: any, b: any) => a.clone().add(b).multiplyScalar(0.5);

  const leftHip = getLM(1);
  const rightHip = getLM(2);
  const spine1 = getLM(3);
  const leftKnee = getLM(4);
  const rightKnee = getLM(5);
  const spine2 = getLM(6);
  const leftAnkle = getLM(7);
  const rightAnkle = getLM(8);
  const spine3 = getLM(9);
  const leftFoot = getLM(10);
  const rightFoot = getLM(11);
  const neck = getLM(12);
  const head = getLM(15);
  const leftShoulder = getLM(16);
  const rightShoulder = getLM(17);
  const leftElbow = getLM(18);
  const rightElbow = getLM(19);
  const leftWrist = getLM(20);
  const rightWrist = getLM(21);
  const nose = getLM(24);

  const hipMid = mid(leftHip, rightHip);
  const shoulderMid = mid(leftShoulder, rightShoulder);

  const alignBone = (boneName: string, childName: string, fromWorld: any, toWorld: any) => {
    if (!isCleanBone(boneName)) return;
    const bone = bones[boneName];
    const child = bones[childName];
    if (!bone || !child) return;

    bone.updateMatrixWorld(true);

    const targetWorldDir = new THREE.Vector3().subVectors(toWorld, fromWorld).normalize();
    const childLocalDir = child.position.clone().normalize();
    const childDirInParent = childLocalDir.clone().applyQuaternion(bone.quaternion).normalize();

    const parentWorldQuat = new THREE.Quaternion();
    if (bone.parent) bone.parent.getWorldQuaternion(parentWorldQuat);
    const targetInParent = targetWorldDir.clone().applyQuaternion(parentWorldQuat.clone().invert()).normalize();

    const rotationDelta = new THREE.Quaternion().setFromUnitVectors(childDirInParent, targetInParent);
    bone.quaternion.premultiply(rotationDelta);
    bone.updateMatrixWorld(true);
  };

  // 1. Hip full orientation frame alignment
  const waistBone = bones['CC_Base_Waist'];
  const lThighBone = bones['CC_Base_L_Thigh'];

  if (hipBone && waistBone && lThighBone) {
    hipBone.position.x = defaultHipPos.x;
    hipBone.position.z = defaultHipPos.z;
    hipBone.position.y = defaultHipPos.y;
    hipBone.updateMatrixWorld(true);

    const restSpine = waistBone.position.clone().normalize();
    const restLateral = lThighBone.position.clone();
    restLateral.sub(restSpine.clone().multiplyScalar(restLateral.dot(restSpine))).normalize();
    const restFwd = new THREE.Vector3().crossVectors(restLateral, restSpine).normalize();
    restLateral.crossVectors(restSpine, restFwd).normalize();

    const targetSpine = new THREE.Vector3().subVectors(shoulderMid, hipMid).normalize();
    const targetLateral = new THREE.Vector3().subVectors(leftHip, rightHip);
    targetLateral.sub(targetSpine.clone().multiplyScalar(targetLateral.dot(targetSpine))).normalize();
    const targetFwd = new THREE.Vector3().crossVectors(targetLateral, targetSpine).normalize();
    targetLateral.crossVectors(targetSpine, targetFwd).normalize();

    const parentQuat = new THREE.Quaternion();
    if (hipBone.parent) hipBone.parent.getWorldQuaternion(parentQuat);
    const invParent = parentQuat.clone().invert();

    const tSpineLocal = targetSpine.clone().applyQuaternion(invParent);
    const tLateralLocal = targetLateral.clone().applyQuaternion(invParent);
    const tFwdLocal = targetFwd.clone().applyQuaternion(invParent);

    const restMat = new THREE.Matrix4().makeBasis(restLateral, restSpine, restFwd);
    const targetMat = new THREE.Matrix4().makeBasis(tLateralLocal, tSpineLocal, tFwdLocal);
    const hipRotMat = targetMat.clone().multiply(restMat.clone().invert());

    hipBone.quaternion.setFromRotationMatrix(hipRotMat);
    hipBone.updateMatrixWorld(true);
  }

  // 2. Align Torso / Spine
  alignBone('CC_Base_Waist', 'CC_Base_Spine01', hipMid, spine1);
  alignBone('CC_Base_Spine01', 'CC_Base_Spine02', spine1, spine2);
  alignBone('CC_Base_Spine02', 'CC_Base_NeckTwist01', spine2, neck);

  // 3. Align Arms
  alignBone('CC_Base_L_Clavicle', 'CC_Base_L_Upperarm', shoulderMid, leftShoulder);
  alignBone('CC_Base_L_Upperarm', 'CC_Base_L_Forearm', leftShoulder, leftElbow);
  alignBone('CC_Base_L_Forearm', 'CC_Base_L_Hand', leftElbow, leftWrist);
  const leftHandLM = getLM(61).lengthSq() > 0 ? getLM(61) : (getLM(63).lengthSq() > 0 ? getLM(63) : leftWrist.clone().add(new THREE.Vector3(0, -10, 0)));
  console.log('[Pose Debug] leftHandLM:', leftHandLM.toArray(), 'leftWrist:', leftWrist.toArray(), 'Mid1 child pos:', bones['CC_Base_L_Mid1']?.position?.toArray());
  alignBone('CC_Base_L_Hand', 'CC_Base_L_Mid1', leftWrist, leftHandLM);

  alignBone('CC_Base_R_Clavicle', 'CC_Base_R_Upperarm', shoulderMid, rightShoulder);
  alignBone('CC_Base_R_Upperarm', 'CC_Base_R_Forearm', rightShoulder, rightElbow);
  alignBone('CC_Base_R_Forearm', 'CC_Base_R_Hand', rightElbow, rightWrist);
  const rightHandLM = getLM(67).lengthSq() > 0 ? getLM(67) : (getLM(68).lengthSq() > 0 ? getLM(68) : rightWrist.clone().add(new THREE.Vector3(0, -10, 0)));
  console.log('[Pose Debug] rightHandLM:', rightHandLM.toArray(), 'rightWrist:', rightWrist.toArray());
  alignBone('CC_Base_R_Hand', 'CC_Base_R_Mid1', rightWrist, rightHandLM);

  // 4. Align Legs
  alignBone('CC_Base_L_Thigh', 'CC_Base_L_Calf', leftHip, leftKnee);
  alignBone('CC_Base_L_Calf', 'CC_Base_L_Foot', leftKnee, leftAnkle);
  const leftToeLM = getLM(55).lengthSq() > 0 ? getLM(55) : leftFoot;
  console.log('[Pose Debug] leftToeLM:', leftToeLM.toArray(), 'leftAnkle:', leftAnkle.toArray(), 'ToeBase child pos:', bones['CC_Base_L_ToeBase']?.position?.toArray());
  alignBone('CC_Base_L_Foot', 'CC_Base_L_ToeBase', leftAnkle, leftToeLM);

  alignBone('CC_Base_R_Thigh', 'CC_Base_R_Calf', rightHip, rightKnee);
  alignBone('CC_Base_R_Calf', 'CC_Base_R_Foot', rightKnee, rightAnkle);
  const rightToeLM = getLM(56).lengthSq() > 0 ? getLM(56) : rightFoot;
  alignBone('CC_Base_R_Foot', 'CC_Base_R_ToeBase', rightAnkle, rightToeLM);

  // 5. Align Neck / Head
  const headTarget = head.lengthSq() > 0 ? head : (nose.lengthSq() > 0 ? nose : neck);
  alignBone('CC_Base_NeckTwist01', 'CC_Base_Head', neck, headTarget);

  scene.updateMatrixWorld(true);

  // 6. Ground adjustment: adjust hip height so the lowest bone rests at root floor height
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

  if (lowestBoneY !== Infinity && hipBone && hipBone.parent) {
    const diffY = rootPos.y - lowestBoneY;
    const hipWorldPos = new THREE.Vector3();
    hipBone.getWorldPosition(hipWorldPos);
    hipWorldPos.x = rootPos.x;
    hipWorldPos.z = rootPos.z;
    hipWorldPos.y += diffY;
    hipBone.parent.worldToLocal(hipWorldPos);
    hipBone.position.copy(hipWorldPos);
    hipBone.updateMatrixWorld(true);
  }
};

