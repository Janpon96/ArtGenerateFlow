/**
 * source-image.ts: đọc một ảnh người dùng chọn để gửi lên bridge (tab BG Room, Camera Image).
 * Không từ chối ảnh lớn: ảnh quá nặng hoặc quá to được thu nhỏ trước khi gửi.
 */

export interface SourceImage {
  name: string;
  mime: string;
  base64: string;
  dataUrl: string;
  /** Kích thước ảnh sẽ được gửi đi (sau khi thu nhỏ nếu có). */
  width: number;
  height: number;
  /** Kích thước ảnh gốc người dùng chọn. */
  originalWidth: number;
  originalHeight: number;
  /** Dòng mô tả ngắn để hiện cho người dùng, ví dụ "1977×2560, 15.2 MB, đã thu nhỏ còn 1977×2560". */
  summary: string;
}

/** Ảnh nhẹ hơn ngưỡng này và cạnh dài không quá MAX_SIDE thì gửi nguyên bản. */
export const KEEP_ORIGINAL_BYTES = 5 * 1024 * 1024;
export const MAX_SIDE = 2560;
/** Ảnh PNG sau khi thu nhỏ vẫn nặng hơn mức này thì chuyển sang JPEG. */
const PNG_LIMIT_BYTES = 6 * 1024 * 1024;

export const fmtMB = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Cạnh dài nhất không vượt `maxSide`; không bao giờ phóng to. */
export function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch { /* thử cách khác bên dưới */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode'));
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Không mã hóa được ảnh.'))), type, quality);
  });
}

/** Ném Error với thông báo tiếng Việt nếu trình duyệt không đọc được file. */
export async function readSourceImage(file: File): Promise<SourceImage> {
  let decoded;
  try {
    decoded = await decode(file);
  } catch {
    throw new Error(`Không đọc được "${file.name}". Hãy chọn ảnh PNG, JPEG hoặc WebP.`);
  }
  const { source, width: ow, height: oh } = decoded;
  try {
    let blob: Blob = file;
    let mime = file.type || 'image/png';
    let { width, height } = { width: ow, height: oh };
    let note = '';

    if (file.size > KEEP_ORIGINAL_BYTES || Math.max(ow, oh) > MAX_SIDE) {
      ({ width, height } = fitSize(ow, oh, MAX_SIDE));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Trình duyệt không hỗ trợ canvas.');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, width, height);
      blob = await canvasBlob(canvas, 'image/png');
      mime = 'image/png';
      if (blob.size > PNG_LIMIT_BYTES) {
        blob = await canvasBlob(canvas, 'image/jpeg', 0.92);
        mime = 'image/jpeg';
      }
      note = `, đã tối ưu còn ${width}×${height}, ${fmtMB(blob.size)}`;
    }

    const base64 = toBase64(new Uint8Array(await blob.arrayBuffer()));
    return {
      name: file.name,
      mime,
      base64,
      dataUrl: `data:${mime};base64,${base64}`,
      width,
      height,
      originalWidth: ow,
      originalHeight: oh,
      summary: `${file.name}: ${ow}×${oh}, ${fmtMB(file.size)}${note}`,
    };
  } finally {
    decoded.close();
  }
}
