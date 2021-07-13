import { Keypoint, Pose } from '@tensorflow-models/posenet';
import { Tree } from './tree';

function exists<T>(value: T | undefined | null): value is T {
  return value != null;
}

export type Skeleton = Tree<Part, JointPosition>;

export type Part = 'nose'
    | 'leftEye'
    | 'rightEye'
    | 'leftEar'
    | 'rightEar'
    | 'leftShoulder'
    | 'rightShoulder'
    | 'leftElbow'
    | 'rightElbow'
    | 'leftWrist'
    | 'rightWrist'
    | 'leftHip'
    | 'rightHip'
    | 'leftKnee'
    | 'rightKnee'
    | 'leftAnkle'
    | 'rightAnkle';

const flippedParts: {[key in Part]: Part} = {
  ['nose']: 'nose',
  ['leftEye']: 'rightEye',
  ['rightEye']: 'leftEye',
  ['leftEar']: 'rightEar',
  ['rightEar']: 'leftEar',
  ['leftShoulder']: 'rightShoulder',
  ['rightShoulder']: 'leftShoulder',
  ['leftElbow']: 'rightElbow',
  ['rightElbow']: 'leftElbow',
  ['leftWrist']: 'rightWrist',
  ['rightWrist']: 'leftWrist',
  ['leftHip']: 'rightHip',
  ['rightHip']: 'leftHip',
  ['leftKnee']: 'rightKnee',
  ['rightKnee']: 'leftKnee',
  ['leftAnkle']: 'rightAnkle',
  ['rightAnkle']: 'leftAnkle',
};

export type JointPosition = {
  angle: number,
  angleRelativeToParent: number,
  keypoint: Keypoint;  
};

const REQUIRED_PARTS: Part[] = [
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
];

type SkeletonTemplate = Tree<Part, number>

const skeletonTemplate: SkeletonTemplate = new Tree(1);
const skeletonLeftShoulder = skeletonTemplate;
skeletonLeftShoulder
    .addChild(3, 'leftElbow')
    .addChild(1, 'leftWrist');
skeletonLeftShoulder 
    .addChild(2, 'leftHip')
    .addChild(1, 'leftKnee')
    .addChild(1, 'leftAnkle');

const skeletonRightShoulder = skeletonTemplate.addChild(1, 'rightShoulder');
skeletonRightShoulder
    .addChild(3, 'rightElbow')
    .addChild(1, 'rightWrist');
skeletonRightShoulder
    .addChild(2, 'rightHip')
    .addChild(1, 'rightKnee')
    .addChild(1, 'rightAnkle');

export function flipPose(pose: Pose): Pose {
  return {
    ...pose,
    keypoints: pose.keypoints.map(keypoint => ({
      ...keypoint,
      part: flippedParts[keypoint.part as Part],
    })),
  } 
}

export function buildSkeletonFromPose(pose: Pose, minScore = .8): Skeleton | undefined {
  const keypoints = new Map<Part, Keypoint>(
    pose.keypoints.map(keypoint => keypoint.score >= minScore
        ? [keypoint.part as Part, keypoint] as const
        : undefined,
    ).filter(exists),
  );
  const hasAllRequiredParts = REQUIRED_PARTS.every(part => {
    const keypoint = keypoints.get(part);
    return keypoint != null;
  });
  if (!hasAllRequiredParts) {
    return;
  }

  const root = keypoints.get('leftShoulder')!;

  const tree = new Tree<Part, JointPosition>(
      {
        angle: Math.PI/2,
        angleRelativeToParent: 0,
        keypoint: root,
      },
      (jointPosition) => jointPosition.keypoint.part as Part,
  );
  return buildSkeletonPart(tree, keypoints, skeletonTemplate, minScore);
}

export function compareSkeltons(referenceSkeleton: Skeleton, comparisonSkeleton: Skeleton, scores?: Map<Part, number>): number {
  return compareSkeletonParts(referenceSkeleton, comparisonSkeleton, skeletonTemplate, 1, scores);
}

function compareSkeletonParts(referenceSkeleton: Skeleton, comparisonSkeleton: Skeleton, template: SkeletonTemplate, multiplier: number, scores?: Map<Part, number>): number {
  let totalWeight = 0;
  let childValues = 0;
  let dangle = normalizeAngle(comparisonSkeleton.value.angleRelativeToParent - referenceSkeleton.value.angleRelativeToParent);
  const score = Math.pow(1 - Math.abs(dangle)/Math.PI, 2) * multiplier;
  scores?.set(referenceSkeleton.value.keypoint.part as Part, score);

  for(const part of referenceSkeleton.getChildKeys()) {
    const childReferenceSkeleton = referenceSkeleton.getChild(part);
    const childComparisonSkeleton = comparisonSkeleton.getChild(part);
    const childTemplate = template.getChild(part)!;
    if (childReferenceSkeleton != null && childComparisonSkeleton != null) {
      totalWeight += childTemplate.value;
      childValues += compareSkeletonParts(childReferenceSkeleton, childComparisonSkeleton, childTemplate, score, scores) * childTemplate.value;  
    }
  }
  return totalWeight > 0
      ? childValues/totalWeight
      : score;
}

function buildSkeletonPart(skeleton: Skeleton, keypoints: Map<Part, Keypoint>, template: SkeletonTemplate, minScore: number) {
  for (const part of template.getChildKeys()) {
    const keypoint = keypoints.get(part);
    const childTemplate = template.getChild(part)!;
    if (keypoint != null && keypoint.score >= minScore) {
      const dx = keypoint.position.x - skeleton.value.keypoint.position.x;
      const dy = keypoint.position.y - skeleton.value.keypoint.position.y;
      const angle = Math.atan2(dy, dx);
      const angleRelativeToParent = normalizeAngle(angle - skeleton.value.angle);
      const childSkeleton = skeleton.addChild({
        keypoint,
        angle,
        angleRelativeToParent,
      });
      buildSkeletonPart(childSkeleton, keypoints, childTemplate, minScore);
    }
  }
  return skeleton;
}

function computeNosePosition(keypoints: Map<Part, Keypoint>, score: number) {
  const leftShoulder = keypoints.get('leftShoulder')!;
  const rightShoulder = keypoints.get('rightShoulder')!;

  const dx = rightShoulder.position.x - leftShoulder.position.x;
  const dy = rightShoulder.position.y - leftShoulder.position.y;
  const angle = Math.atan2(dy, dx) + Math.PI/2;
  const d = Math.sqrt(dx * dx + dy * dy);
  const neckLength = d/2;

  return {
    part: 'nose',
    position: {
      x: (leftShoulder.position.x + rightShoulder.position.x)/2 + Math.cos(angle) * neckLength,
      y: (leftShoulder.position.y + rightShoulder.position.y)/2 + Math.sin(angle) * neckLength,
    },
    score,
  }
}

function normalizeAngle(a: number) {
  while (a > Math.PI)  {
    a -= Math.PI * 2;
  }
  while (a < -Math.PI) {
    a += Math.PI * 2;
  }
  return a;
}
