/**
 * Prompt cho tab BG Room: từ một ảnh phòng chibi isometric, tạo các ảnh nền illust 2D nhìn từ
 * giữa phòng về từng góc / vật thể. Hàm thuần, không đụng DOM, để kiểm thử được.
 */

export interface RoomView {
  id: string;
  /** Tên hiển thị (tiếng Việt) và tên file. */
  label: string;
  /** Mô tả hướng nhìn, viết bằng tiếng Anh cho model. */
  target: string;
}

/** Ảnh isometric thường chỉ lộ 2 bức tường sau và sàn; 2 tường phía người xem model phải tự suy ra. */
export const ROOM_VIEW_PRESETS: RoomView[] = [
  {
    id: 'corner',
    label: 'Góc phòng chính',
    target: 'the back corner where the two visible walls of the isometric image meet, showing parts of both walls and the furniture in front of them',
  },
  {
    id: 'left-wall',
    label: 'Tường trái',
    target: 'the left wall of the isometric image, viewed straight on, with every piece of furniture and decoration that stands against it',
  },
  {
    id: 'right-wall',
    label: 'Tường phải',
    target: 'the right wall of the isometric image, viewed straight on, with every piece of furniture and decoration that stands against it',
  },
  {
    id: 'front-side',
    label: 'Phía đối diện (suy diễn)',
    target: 'the side of the room that is cut away and not shown in the isometric image; design it as a plausible continuation of the same room (same wall color, floor, materials and decoration style), with a door or window',
  },
  {
    id: 'wide',
    label: 'Toàn cảnh rộng',
    target: 'the whole room in one wide-angle establishing shot taken from just inside the doorway, showing as much of the furniture as possible',
  },
];

export interface RoomPromptOptions {
  /** id của các góc nhìn có sẵn được chọn. */
  viewIds: string[];
  /** Tên vật thể do người dùng nhập, mỗi vật một ảnh cận cảnh. */
  objects: string[];
  artStyle: string;
  notes: string;
}

export interface RoomPrompt {
  label: string;
  prompt: string;
}

export const MAX_ROOM_VIEWS = 8;

/** Tách "giường, bàn học; kệ sách" thành danh sách, bỏ trùng và bỏ rỗng. */
export function parseObjects(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const name = raw.trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

const endStop = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);

function promptFor(target: string, artStyle: string, notes: string): string {
  const parts = [
    'Image 1 is an isometric chibi diorama of a room. Use it only as the design sheet of that room: keep the same furniture, objects, wall and floor materials, colors, patterns and decorations, and keep each object in the same place relative to the others.',
    'TASK: Draw a 2D illustrated background (game / visual novel illust BG) of this same room, seen from inside it.',
    `CAMERA: first-person eye-level view of a person standing in the center of the room, looking toward ${endStop(target)}`,
    'Use normal human-scale interior perspective with a level horizon and correct vanishing points. This must NOT be isometric, NOT top-down, and NOT a miniature or diorama: the walls rise above the viewer, the ceiling or upper wall can be visible, and furniture has real full-size proportions instead of chibi or toy proportions.',
    'Fill the whole frame with the room. Background only: no characters, no people, no animals, no text, no logo, no UI, no border.',
  ];
  if (artStyle.trim()) parts.push(`ART STYLE: ${endStop(artStyle.trim())}`);
  if (notes.trim()) parts.push(`EXTRA NOTES: ${endStop(notes.trim())}`);
  return parts.join(' ');
}

/** Một prompt cho mỗi góc nhìn được chọn, rồi tới mỗi vật thể; tối đa MAX_ROOM_VIEWS. */
export function buildRoomPrompts(opts: RoomPromptOptions): RoomPrompt[] {
  const out: RoomPrompt[] = [];
  for (const view of ROOM_VIEW_PRESETS) {
    if (opts.viewIds.includes(view.id)) {
      out.push({ label: view.label, prompt: promptFor(view.target, opts.artStyle, opts.notes) });
    }
  }
  for (const name of opts.objects) {
    out.push({
      label: `Vật thể: ${name}`,
      prompt: promptFor(
        `the "${name}" from the isometric image, framed as the main subject of the shot from a few steps away, with the wall and the neighbouring furniture around it still visible`,
        opts.artStyle,
        opts.notes,
      ),
    });
  }
  return out.slice(0, MAX_ROOM_VIEWS);
}
