/**
 * Prompt cho tab Camera Image: vẽ lại cùng một cảnh illust từ góc máy khác.
 * Hàm thuần, không đụng DOM, để kiểm thử được.
 */

export interface CameraOption {
  id: string;
  group: 'angle' | 'size' | 'side';
  /** Tên hiển thị (tiếng Việt). */
  label: string;
  /** Mô tả góc máy, viết bằng tiếng Anh cho model. */
  camera: string;
}

export const CAMERA_GROUPS: Record<CameraOption['group'], string> = {
  angle: 'Độ cao máy',
  size: 'Cỡ cảnh',
  side: 'Hướng nhìn',
};

export const CAMERA_OPTIONS: CameraOption[] = [
  { id: 'low', group: 'angle', label: 'Góc thấp (từ dưới lên)', camera: 'low-angle shot: the camera is placed low, near the ground, and tilted upward at the subject, so the subject towers over the viewer and the ceiling or sky is visible behind them' },
  { id: 'worm', group: 'angle', label: 'Sát đất (worm\'s-eye)', camera: "worm's-eye view: the camera is on the ground looking almost straight up at the subject, with strong vertical foreshortening" },
  { id: 'eye', group: 'angle', label: 'Ngang tầm mắt', camera: 'eye-level shot: the camera is at the height of the subject\'s eyes, pointing horizontally, with a level horizon' },
  { id: 'high', group: 'angle', label: 'Góc cao (từ trên xuống)', camera: 'high-angle shot: the camera is above head height and tilted downward at the subject, so the floor or ground is visible around them' },
  { id: 'bird', group: 'angle', label: 'Từ trên cao (bird\'s-eye)', camera: "bird's-eye view: the camera is directly overhead looking straight down at the subject and the floor plan of the scene" },
  { id: 'dutch', group: 'angle', label: 'Nghiêng máy (Dutch angle)', camera: 'Dutch angle: the camera is rolled about 20 degrees so the horizon is clearly tilted, creating a tense, dynamic frame' },

  { id: 'ecu', group: 'size', label: 'Đặc tả (extreme close-up)', camera: 'extreme close-up: the frame is filled by the eyes and part of the face only' },
  { id: 'cu', group: 'size', label: 'Cận cảnh (close-up)', camera: 'close-up: the frame shows the head and the top of the shoulders' },
  { id: 'mcu', group: 'size', label: 'Trung cận (medium close-up)', camera: 'medium close-up: the frame shows the subject from the chest up' },
  { id: 'ms', group: 'size', label: 'Trung cảnh (medium shot)', camera: 'medium shot: the frame shows the subject from the waist up' },
  { id: 'cowboy', group: 'size', label: 'Ngang đùi (cowboy shot)', camera: 'cowboy shot: the frame shows the subject from mid-thigh up' },
  { id: 'full', group: 'size', label: 'Toàn thân (full shot)', camera: 'full shot: the whole body from head to feet is in frame with a little space above and below' },
  { id: 'wide', group: 'size', label: 'Toàn cảnh (wide shot)', camera: 'wide shot: the camera is far back, the subject is small in the frame and the surrounding environment dominates' },

  { id: 'front', group: 'side', label: 'Chính diện', camera: 'front view: the camera faces the subject head-on' },
  { id: 'three-quarter', group: 'side', label: 'Góc 3/4', camera: 'three-quarter view: the camera is about 45 degrees to the side of the subject\'s front' },
  { id: 'profile', group: 'side', label: 'Nghiêng ngang (profile)', camera: 'side profile view: the camera is exactly 90 degrees to the side of the subject' },
  { id: 'back', group: 'side', label: 'Từ phía sau', camera: 'back view: the camera is behind the subject, showing their back and what they are facing' },
  { id: 'ots', group: 'side', label: 'Qua vai (over-the-shoulder)', camera: 'over-the-shoulder shot: the camera is just behind the subject, with their shoulder and the back of their head in the near foreground, looking at what they see' },
];

export interface CameraPromptOptions {
  optionIds: string[];
  /** Góc máy tự nhập, mỗi dòng (hoặc mỗi mục cách nhau dấu chấm phẩy) là một ảnh. */
  custom: string[];
  artStyle: string;
  notes: string;
  /** Giữ nguyên tư thế nhân vật, hay cho phép chỉnh nhẹ cho hợp góc máy. */
  keepPose: boolean;
}

export interface CameraPrompt {
  label: string;
  prompt: string;
}

export const MAX_CAMERA_SHOTS = 8;

/** Tách các góc máy tự nhập theo dòng hoặc dấu chấm phẩy; dấu phẩy được giữ vì hay nằm trong mô tả. */
export function parseCustomCameras(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[;\n]/)) {
    const item = raw.trim().replace(/\s+/g, ' ');
    const key = item.toLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

const endStop = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);

function promptFor(camera: string, o: CameraPromptOptions): string {
  const parts = [
    'Image 1 is the source illustration.',
    'TASK: Redraw the SAME scene and the SAME moment as image 1, photographed from a different camera position.',
    'KEEP: every character (face, hair, eyes, body type, outfit, accessories, colors), the location, props, lighting direction, time of day, mood, and the art style, linework and coloring of image 1.',
    o.keepPose
      ? 'POSE: the characters hold exactly the same pose, gesture and expression as in image 1; only the viewpoint changes.'
      : 'POSE: keep the same action and expression; small natural adjustments of the pose are allowed if the new viewpoint needs them.',
    `NEW CAMERA: ${endStop(camera)}`,
    'Draw whatever this viewpoint reveals that image 1 does not show (other sides of the characters, more of the room or landscape), consistent with image 1, with correct perspective and foreshortening.',
    'The result must clearly be a different camera angle from image 1. Do not return a crop, zoom, mirror or copy of image 1. No text, no logo, no border.',
  ];
  if (o.artStyle.trim()) parts.push(`ART STYLE: ${endStop(o.artStyle.trim())}`);
  if (o.notes.trim()) parts.push(`EXTRA NOTES: ${endStop(o.notes.trim())}`);
  return parts.join(' ');
}

/** Một prompt cho mỗi góc máy được chọn (theo thứ tự danh sách), rồi tới các góc tự nhập. */
export function buildCameraPrompts(o: CameraPromptOptions): CameraPrompt[] {
  const out: CameraPrompt[] = [];
  for (const opt of CAMERA_OPTIONS) {
    if (o.optionIds.includes(opt.id)) out.push({ label: opt.label, prompt: promptFor(opt.camera, o) });
  }
  for (const text of o.custom) out.push({ label: `Tùy chỉnh: ${text}`, prompt: promptFor(text, o) });
  return out.slice(0, MAX_CAMERA_SHOTS);
}

/** Flow chỉ có 3 tỉ lệ; chọn cái gần ảnh nguồn nhất để góc máy mới không bị cắt lệch. */
export function aspectForImage(width: number, height: number): '16:9' | '9:16' | '1:1' {
  if (!(width > 0 && height > 0)) return '16:9';
  const r = width / height;
  if (r > 1.15) return '16:9';
  if (r < 0.87) return '9:16';
  return '1:1';
}
