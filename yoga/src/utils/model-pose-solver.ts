import { getBoneFleshRadius, isArmBone, isLegBone, isCleanBone } from '@/utils/pose-utils';

export const enforceLockToFloor = (scene: any, THREE: any) => {
  let model: any = null;
  scene.traverse((child: any) => {
    if (child.isBone && child.name === 'CC_Base_BoneRoot') {
      let curr = child;
      while (curr.parent && curr.parent !== scene) {
        curr = curr.parent;
      }
      model = curr;
    }
  });

  if (!model) return;

  model.position.y = 0;
  model.updateMatrixWorld(true);

  // Detect the yoga mat surface Y coordinate
  let floorY = 0;
  scene.traverse((child: any) => {
    if (child.name === 'yoga-mat') {
      floorY = child.position.y;
    }
  });

  // Find the bone that is locked to the floor
  let targetBone: any = null;
  scene.traverse((child: any) => {
    if (child.isBone && child.userData.lockToFloor) {
      targetBone = child;
    }
  });

  if (targetBone) {
    const boneWorldPos = new THREE.Vector3();
    targetBone.getWorldPosition(boneWorldPos);
    const boneY = boneWorldPos.y;
    const radius = getBoneFleshRadius(targetBone.name);

    model.position.y = -(boneY - radius) + floorY;
    model.updateMatrixWorld(true);
    return;
  }

  const box = new THREE.Box3().setFromObject(model);
  const minY = box.min.y;

  model.position.y = -minY + floorY;
  model.updateMatrixWorld(true);
};

export const applyIK = (scene: any, THREE: any, ikLegsEnabled: boolean, ikArmsEnabled: boolean) => {
  const bones: { [name: string]: any } = {};
  scene.traverse((child: any) => {
    if (child.isBone) bones[child.name] = child;
  });

  let floorY = 0;
  scene.traverse((child: any) => {
    if (child.name === 'yoga-mat') {
      floorY = child.position.y;
    }
  });

  const limbs = [];
  if (ikLegsEnabled) {
    limbs.push(
      { start: 'CC_Base_L_Thigh', mid: 'CC_Base_L_Calf', end: 'CC_Base_L_Foot' },
      { start: 'CC_Base_R_Thigh', mid: 'CC_Base_R_Calf', end: 'CC_Base_R_Foot' }
    );
  }
  if (ikArmsEnabled) {
    limbs.push(
      { start: 'CC_Base_L_Upperarm', mid: 'CC_Base_L_Forearm', end: 'CC_Base_L_Hand' },
      { start: 'CC_Base_R_Upperarm', mid: 'CC_Base_R_Forearm', end: 'CC_Base_R_Hand' }
    );
  }

  const rotateBoneTowards = (bone: any, currentDirWorld: any, targetDirWorld: any) => {
    const parentWorldQuat = new THREE.Quaternion();
    if (bone.parent) bone.parent.getWorldQuaternion(parentWorldQuat);
    const invParent = parentWorldQuat.clone().invert();

    const dirLocal = currentDirWorld.clone().applyQuaternion(invParent).normalize();
    const targetLocal = targetDirWorld.clone().applyQuaternion(invParent).normalize();

    const delta = new THREE.Quaternion().setFromUnitVectors(dirLocal, targetLocal);
    bone.quaternion.premultiply(delta);
    bone.updateMatrixWorld(true);
  };

  limbs.forEach(({ start, mid, end }) => {
    const startBone = bones[start];
    const midBone = bones[mid];
    const endBone = bones[end];

    if (!startBone || !midBone || !endBone) return;

    const endPos = new THREE.Vector3();
    endBone.getWorldPosition(endPos);

    if (endPos.y < floorY) {
      const target = new THREE.Vector3(endPos.x, floorY, endPos.z);

      for (let iter = 0; iter < 10; iter++) {
        const posStart = new THREE.Vector3();
        const posMid = new THREE.Vector3();
        const posEnd = new THREE.Vector3();
        startBone.getWorldPosition(posStart);
        midBone.getWorldPosition(posMid);
        endBone.getWorldPosition(posEnd);

        const vMidEnd = new THREE.Vector3().subVectors(posEnd, posMid);
        const vMidTarget = new THREE.Vector3().subVectors(target, posMid);
        if (vMidEnd.lengthSq() > 0.00001 && vMidTarget.lengthSq() > 0.00001) {
          rotateBoneTowards(midBone, vMidEnd.normalize(), vMidTarget.normalize());
        }

        scene.updateMatrixWorld(true);
        endBone.getWorldPosition(posEnd);

        const vStartEnd = new THREE.Vector3().subVectors(posEnd, posStart);
        const vStartTarget = new THREE.Vector3().subVectors(target, posStart);
        if (vStartEnd.lengthSq() > 0.00001 && vStartTarget.lengthSq() > 0.00001) {
          rotateBoneTowards(startBone, vStartEnd.normalize(), vStartTarget.normalize());
        }

        scene.updateMatrixWorld(true);
      }
    }
  });
};

export const enforceSymmetry = (
  scene: any,
  symmetricArmsEnabled: boolean,
  symmetricLegsEnabled: boolean
) => {
  const boneMap = new Map<string, any>();
  scene.traverse((child: any) => {
    if (child.isBone) {
      boneMap.set(child.name, child);
    }
  });

  if (symmetricArmsEnabled) {
    ['CC_Base_Waist', 'CC_Base_Spine01', 'CC_Base_Spine02'].forEach((spineName) => {
      const spineBone = boneMap.get(spineName);
      if (spineBone && Math.abs(spineBone.rotation.z) > 0.001) {
        spineBone.rotation.z = 0;
        spineBone.updateMatrixWorld(true);
      }
    });
  }

  boneMap.forEach((bone, name) => {
    if (name.includes('_R_')) {
      const leftName = name.replace('_R_', '_L_');
      const leftBone = boneMap.get(leftName);
      if (leftBone) {
        const isArm = isArmBone(name);
        const isLeg = isLegBone(name);
        const shouldSymmetrize = (isArm && symmetricArmsEnabled) || (isLeg && symmetricLegsEnabled);
        if (shouldSymmetrize) {
          leftBone.quaternion.set(
            bone.quaternion.x,
            -bone.quaternion.y,
            -bone.quaternion.z,
            bone.quaternion.w
          );
          leftBone.rotation.setFromQuaternion(leftBone.quaternion);
          leftBone.updateMatrixWorld(true);
        }
      }
    }
  });
};

export const updateModelPose = (
  scene: any,
  THREE: any,
  ikLegsEnabled: boolean,
  ikArmsEnabled: boolean,
  symmetricArmsEnabled: boolean,
  symmetricLegsEnabled: boolean,
  refFootX?: number | null | 'center'
) => {
  if (!THREE || !scene) return;

  if (symmetricArmsEnabled || symmetricLegsEnabled) {
    enforceSymmetry(scene, symmetricArmsEnabled, symmetricLegsEnabled);
  }

  let hasLockedBone = false;
  scene.traverse((child: any) => {
    if (child.isBone && child.userData.lockToFloor) {
      hasLockedBone = true;
    }
  });

  const anyIk = ikLegsEnabled || ikArmsEnabled;
  if (anyIk) applyIK(scene, THREE, ikLegsEnabled, ikArmsEnabled);
  if (hasLockedBone) {
    enforceLockToFloor(scene, THREE);
  } else {
    let model: any = null;
    scene.traverse((child: any) => {
      if (child.isBone && child.name === 'CC_Base_BoneRoot') {
        let curr = child;
        while (curr.parent && curr.parent !== scene) {
          curr = curr.parent;
        }
        model = curr;
      }
    });
    if (model) {
      model.position.y = 0;
      model.updateMatrixWorld(true);
    }
  }

  if (anyIk) {
    applyIK(scene, THREE, ikLegsEnabled, ikArmsEnabled);
    if (hasLockedBone) {
      enforceLockToFloor(scene, THREE);
    }
  }

  // Mandatory Constraint 1: ensure no part of the body goes inside/below the floor (considering flesh size)
  let model: any = null;
  scene.traverse((child: any) => {
    if (child.isBone && child.name === 'CC_Base_BoneRoot') {
      let curr = child;
      while (curr.parent && curr.parent !== scene) {
        curr = curr.parent;
      }
      model = curr;
    }
  });

  if (model) {
    let floorY = 0;
    scene.traverse((child: any) => {
      if (child.name === 'yoga-mat') {
        floorY = child.position.y;
      }
    });

    let minFleshY = Infinity;
    scene.traverse((child: any) => {
      if (child.isBone && child.name !== 'CC_Base_BoneRoot' && child.name !== 'RootNode') {
        const boneWorldPos = new THREE.Vector3();
        child.getWorldPosition(boneWorldPos);
        const radius = getBoneFleshRadius(child.name);
        const lowestPoint = boneWorldPos.y - radius;
        if (lowestPoint < minFleshY) {
          minFleshY = lowestPoint;
        }
      }
    });

    if (minFleshY < floorY) {
      model.position.y += (floorY - minFleshY);
      model.updateMatrixWorld(true);
    }
  }

  // Mandatory Constraint 2: Center the body on the short side of the yoga mat (Z = 0)
  centerBodyOnShortSideOfMat(scene, THREE);

  // Optional Constraint 3: Long side (X axis) positioning
  if (refFootX === 'center') {
    centerBodyOnLongSideOfMat(scene, THREE);
  } else if (typeof refFootX === 'number' && refFootX !== null && model) {
    const currBackwardX = getBackwardFootX(scene, THREE);
    if (currBackwardX !== null) {
      const deltaX = refFootX - currBackwardX;
      model.position.x += deltaX;
      model.updateMatrixWorld(true);
    }
  }
};

export const getBackwardFootX = (scene: any, THREE: any): number | null => {
  if (!scene || !THREE) return null;

  let leftFoot: any = null;
  let rightFoot: any = null;
  let hipBone: any = null;
  let spineBone: any = null;
  let lThigh: any = null;
  let rThigh: any = null;

  scene.traverse((child: any) => {
    if (child.isBone) {
      if (child.name === 'CC_Base_L_Foot' || child.name === 'CS_Base_L_Foot') leftFoot = child;
      if (child.name === 'CC_Base_R_Foot' || child.name === 'CS_Base_R_Foot') rightFoot = child;
      if (child.name === 'CC_Base_Hip' || child.name === 'CS_Base_hip') hipBone = child;
      if (child.name === 'CC_Base_Spine02' || child.name === 'CC_Base_Spine01' || child.name === 'CC_Base_Head') {
        if (!spineBone || child.name === 'CC_Base_Spine02') spineBone = child;
      }
      if (child.name === 'CC_Base_L_Thigh') lThigh = child;
      if (child.name === 'CC_Base_R_Thigh') rThigh = child;
    }
  });

  if (!leftFoot || !rightFoot) {
    scene.traverse((child: any) => {
      if (child.isBone) {
        if (!leftFoot && (child.name === 'CC_Base_L_ToeBase' || child.name === 'CC_Base_L_Calf')) leftFoot = child;
        if (!rightFoot && (child.name === 'CC_Base_R_ToeBase' || child.name === 'CC_Base_R_Calf')) rightFoot = child;
      }
    });
  }

  const leftPos = new THREE.Vector3();
  const rightPos = new THREE.Vector3();
  let hasLeft = false;
  let hasRight = false;

  if (leftFoot) {
    leftFoot.getWorldPosition(leftPos);
    hasLeft = true;
  }
  if (rightFoot) {
    rightFoot.getWorldPosition(rightPos);
    hasRight = true;
  }

  if (hasLeft && hasRight) {
    if (hipBone && spineBone && lThigh && rThigh) {
      const hipPos = new THREE.Vector3();
      const spinePos = new THREE.Vector3();
      const lThighPos = new THREE.Vector3();
      const rThighPos = new THREE.Vector3();

      hipBone.getWorldPosition(hipPos);
      spineBone.getWorldPosition(spinePos);
      lThigh.getWorldPosition(lThighPos);
      rThigh.getWorldPosition(rThighPos);

      const upVec = new THREE.Vector3().subVectors(spinePos, hipPos).normalize();
      const lateralVec = new THREE.Vector3().subVectors(lThighPos, rThighPos).normalize();
      const forwardVec = new THREE.Vector3().crossVectors(lateralVec, upVec).normalize();

      const leftDist = new THREE.Vector3().subVectors(leftPos, hipPos).dot(forwardVec);
      const rightDist = new THREE.Vector3().subVectors(rightPos, hipPos).dot(forwardVec);

      // The foot with smaller forward displacement is the backward foot
      return leftDist <= rightDist ? leftPos.x : rightPos.x;
    }

    return Math.min(leftPos.x, rightPos.x);
  } else if (hasLeft) {
    return leftPos.x;
  } else if (hasRight) {
    return rightPos.x;
  }

  return null;
};

export const centerBodyOnShortSideOfMat = (scene: any, THREE: any) => {
  if (!scene || !THREE) return;

  let model: any = null;
  scene.traverse((child: any) => {
    if (child.isBone && child.name === 'CC_Base_BoneRoot') {
      let curr = child;
      while (curr.parent && curr.parent !== scene) {
        curr = curr.parent;
      }
      model = curr;
    }
  });

  if (!model) return;

  let matZ = 0;
  scene.traverse((child: any) => {
    if (child.name === 'yoga-mat') {
      matZ = child.position.z;
    }
  });

  let centerBone: any = null;
  scene.traverse((child: any) => {
    if (child.isBone && (child.name === 'CC_Base_Hip' || child.name === 'CC_Base_Waist' || child.name === 'CC_Base_Pelvis')) {
      if (!centerBone || child.name === 'CC_Base_Hip') {
        centerBone = child;
      }
    }
  });

  if (centerBone) {
    const centerWorldPos = new THREE.Vector3();
    centerBone.getWorldPosition(centerWorldPos);
    model.position.z += (matZ - centerWorldPos.z);
    model.updateMatrixWorld(true);
  }
};

export const centerBodyOnLongSideOfMat = (scene: any, THREE: any) => {
  if (!scene || !THREE) return;

  let model: any = null;
  scene.traverse((child: any) => {
    if (child.isBone && child.name === 'CC_Base_BoneRoot') {
      let curr = child;
      while (curr.parent && curr.parent !== scene) {
        curr = curr.parent;
      }
      model = curr;
    }
  });

  if (!model) return;

  let matX = 0;
  scene.traverse((child: any) => {
    if (child.name === 'yoga-mat') {
      matX = child.position.x;
    }
  });

  let centerBone: any = null;
  scene.traverse((child: any) => {
    if (child.isBone && (child.name === 'CC_Base_Hip' || child.name === 'CC_Base_Waist' || child.name === 'CC_Base_Pelvis')) {
      if (!centerBone || child.name === 'CC_Base_Hip') {
        centerBone = child;
      }
    }
  });

  if (centerBone) {
    const centerWorldPos = new THREE.Vector3();
    centerBone.getWorldPosition(centerWorldPos);
    model.position.x += (matX - centerWorldPos.x);
    model.updateMatrixWorld(true);
  }
};

export const getSkeletonBones = (
  viewerRef: any,
  ikLegsEnabled: boolean,
  ikArmsEnabled: boolean,
  symmetricArmsEnabled: boolean,
  symmetricLegsEnabled: boolean
) => {
  const viewer = viewerRef.current;
  if (!viewer) return [];

  const symbols = Object.getOwnPropertySymbols(viewer);
  const sceneSym = symbols.find((s) => s.toString() === 'Symbol(scene)');
  if (!sceneSym) return [];

  const scene = viewer[sceneSym];
  if (!scene) return [];

  const bones: any[] = [];
  scene.traverse((child: any) => {
    if (child.isBone && isCleanBone(child.name)) {
      bones.push({
        name: child.name || '',
        rotation: {
          x: child.rotation.x,
          y: child.rotation.y,
          z: child.rotation.z,
        },
        position: child.position
          ? {
              x: child.position.x,
              y: child.position.y,
              z: child.position.z,
            }
          : undefined,
        lockToFloor: !!child.userData.lockToFloor,
      });
    }
  });

  bones.push({
    name: '__ik_global__',
    rotation: { x: 0, y: 0, z: 0 },
    position: { x: 0, y: 0, z: 0 },
    ikLegsEnabled,
    ikArmsEnabled,
    symmetricArmsEnabled,
    symmetricLegsEnabled,
  } as any);

  return bones;
};
