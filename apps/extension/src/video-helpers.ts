/**
 * video-helpers.ts: hàm thuần cho tab Video (ước tính credit, phân tích phụ đề).
 */

export interface VideoCue {
  start: number;
  end: number;
  text: string;
}

export const CONFIRM_CREDIT_THRESHOLD = 20;

/** Bảng mặc định, bị ghi đè bởi `capabilities.models[0].credits` từ bridge. */
export const DEFAULT_CREDITS: Record<string, number> = { '4': 15, '6': 20, '8': 25, '10': 30 };

export function estimateCredits(duration: number, table: Record<string, number> = DEFAULT_CREDITS): number {
  return table[String(duration)] ?? 0;
}

export function needsCreditConfirm(credits: number): boolean {
  return credits > CONFIRM_CREDIT_THRESHOLD;
}

/** Chấp nhận `12.5` hoặc `mm:ss(.s)`. Trả NaN nếu sai định dạng. */
export function parseTimestamp(raw: string): number {
  const s = raw.trim();
  if (!s) return Number.NaN;
  const parts = s.split(':');
  if (parts.length > 2) return Number.NaN;
  let total = 0;
  for (const p of parts) {
    if (!/^\d+(\.\d+)?$/.test(p)) return Number.NaN;
    total = total * 60 + Number(p);
  }
  return total;
}

const TIMED_LINE = /^\s*([\d:.]+)\s*(?:-->|–|-)\s*([\d:.]+)\s+(\S[\s\S]*)$/;

/**
 * Phân tích văn bản phụ đề.
 * - Dòng có thời gian: `0-2.5 Xin chào` hoặc `00:01 --> 00:03 Xin chào`.
 * - Nếu không dòng nào có thời gian, chia đều các dòng trên toàn bộ `duration`.
 * Ném Error (tiếng Việt) khi trộn hai kiểu hoặc thời gian không hợp lệ.
 */
export function parseCues(text: string, duration: number): VideoCue[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const timed = lines.map((l) => TIMED_LINE.exec(l));
  const timedCount = timed.filter(Boolean).length;
  if (timedCount === 0) {
    const slot = duration / lines.length;
    return lines.map((t, i) => ({
      start: round1(i * slot),
      end: round1((i + 1) * slot),
      text: t,
    }));
  }
  if (timedCount !== lines.length) {
    throw new Error('Phụ đề: hoặc mọi dòng đều có thời gian, hoặc không dòng nào có.');
  }
  const cues: VideoCue[] = timed.map((m, i) => {
    const start = parseTimestamp(m![1]!);
    const end = parseTimestamp(m![2]!);
    if (Number.isNaN(start) || Number.isNaN(end)) throw new Error(`Phụ đề dòng ${i + 1}: thời gian không hợp lệ.`);
    return { start, end, text: m![3]!.trim() };
  });
  validateCues(cues, duration);
  return cues;
}

/** Cùng quy tắc với bridge: end > start, nằm trong thời lượng video, không chồng nhau. */
export function validateCues(cues: VideoCue[], duration: number): void {
  let prevEnd = 0;
  cues.forEach((c, i) => {
    if (!(c.end > c.start)) throw new Error(`Phụ đề dòng ${i + 1}: giờ kết thúc phải lớn hơn giờ bắt đầu.`);
    if (c.end > duration + 0.001) throw new Error(`Phụ đề dòng ${i + 1}: vượt quá thời lượng ${duration}s.`);
    if (c.start < prevEnd - 0.001) throw new Error(`Phụ đề dòng ${i + 1}: chồng lên dòng trước.`);
    prevEnd = c.end;
  });
}

export function cuesToText(cues: VideoCue[]): string {
  return cues.map((c) => `${c.start}-${c.end} ${c.text}`).join('\n');
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
