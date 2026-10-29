import {
  bytesFromBase64, base64FromBytes, modelLabelsMatch,
  type FlowRequest, type FlowResponse, type FlowStepLog, type FlowCollectedImage, type FlowReadbackData,
} from '@frs/provider-flow-web';

/**
 * Content script for the Flow page. Selectors are GUESSES based on visible text and aria
 * labels. They have not been checked against the live Flow UI, so every step reports a
 * clear error code when it cannot find what it expects.
 */

class StepError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const visible = (el: Element) => {
  const r = (el as HTMLElement).getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const textOf = (el: Element) => `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`.trim().toLowerCase();

function findClickable(re: RegExp, root: ParentNode = document): HTMLElement | null {
  const cands = root.querySelectorAll<HTMLElement>('button, [role="button"], [role="option"], [role="menuitem"], [role="tab"], li');
  for (const el of cands) if (visible(el) && re.test(textOf(el))) return el;
  return null;
}

async function waitFor<T>(fn: () => T | null, timeoutMs: number, what: string, code: string): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new StepError(code, `Không tìm thấy: ${what} (quá ${timeoutMs}ms).`);
    await sleep(250);
  }
}

function findPromptBox(): HTMLElement | null {
  const list = [...document.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"], [role="textbox"]')].filter(visible);
  return list.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0] ?? null;
}

function setPrompt(box: HTMLElement, text: string): void {
  box.focus();
  if (box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement) {
    const proto = box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, text);
  }
}

function readPrompt(box: HTMLElement | null): string | null {
  if (!box) return null;
  return box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement ? box.value : (box.textContent ?? '');
}

async function chooseModel(label: string, logs: FlowStepLog[]): Promise<void> {
  const log = (level: FlowStepLog['level'], message: string) => logs.push({ level, message });
  const current = readModelLabel();
  if (current && modelLabelsMatch(current, label)) {
    log('info', `Model hiện tại đã là "${current}".`);
    return;
  }
  // Tìm nút model bằng selector rộng hơn
  const trigger = findClickable(/model|banana|select/i) || document.querySelector('[role="combobox"], [aria-haspopup="listbox"]');
  if (!trigger) throw new StepError('MODEL_MENU_NOT_FOUND', 'Không tìm thấy nút mở menu chọn model.');
  trigger.click();
  await sleep(400);
  const opt = await waitFor(
    () => [...document.querySelectorAll<HTMLElement>('[role="option"], [role="menuitem"], li, button')]
      .find((e) => visible(e) && modelLabelsMatch(e.textContent ?? '', label) && (e.textContent ?? '').length < 80) ?? null,
    4000, `lựa chọn model "${label}"`, 'MODEL_OPTION_NOT_FOUND',
  );
  opt.click();
  await sleep(400);
  log('success', `Đã chọn model "${label}".`);
}

function readModelLabel(): string | null {
  const el = [...document.querySelectorAll<HTMLElement>('button, [role="button"], [role="combobox"]')]
    .find((e) => visible(e) && /nano banana/i.test(e.textContent ?? '') && (e.textContent ?? '').length < 60);
  return el ? (el.textContent ?? '').trim() : null;
}

function findFileInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[type="file"]');
}

async function attachImages(images: Array<{ name: string; mime: string; base64: string }>, logs: FlowStepLog[]): Promise<void> {
  // Attach one by one so the upload order in Flow equals the Source Map order.
  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    let input = findFileInput();
    if (!input) {
      findClickable(/upload|add|thêm|tải|image|ảnh|\+/i)?.click();
      await sleep(500);
      input = findFileInput();
    }
    if (!input) throw new StepError('UPLOAD_INPUT_NOT_FOUND', `Không tìm thấy ô tải file cho ảnh ${i + 1}.`);
    const dt = new DataTransfer();
    dt.items.add(new File([bytesFromBase64(img.base64) as BlobPart], img.name, { type: img.mime }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    logs.push({ level: 'info', message: `Đã gắn ảnh ${i + 1}/${images.length}: ${img.name}` });
    await sleep(1200);
  }
}

function findGenerate(): HTMLElement | null {
  return findClickable(/^(generate|create|tạo)\b|generate|arrow_forward|tạo ảnh/i);
}

const baselineSrcs = new Set<string>();
function pageImages(): HTMLImageElement[] {
  return [...document.querySelectorAll<HTMLImageElement>('img')].filter((i) => visible(i) && i.naturalWidth >= 256);
}

async function toCollected(img: HTMLImageElement): Promise<FlowCollectedImage> {
  try {
    const res = await fetch(img.src);
    const blob = await res.blob();
    return { src: img.src, mime: blob.type || 'image/png', base64: base64FromBytes(new Uint8Array(await blob.arrayBuffer())) };
  } catch {
    return { src: img.src, mime: 'image/png', base64: null };
  }
}

async function handle(req: FlowRequest): Promise<FlowResponse> {
  const logs: FlowStepLog[] = [];
  try {
    switch (req.type) {
      case 'ping':
        logs.push({ level: 'success', message: `Content script sẵn sàng trên ${location.host}${location.pathname}` });
        return { ok: true, logs };
      case 'fill': {
        if (req.model) await chooseModel(req.model, logs);
        else logs.push({ level: 'info', message: 'Không chọn model (Agent Auto).' });
        await attachImages(req.images, logs);
        const box = await waitFor(findPromptBox, 4000, 'ô nhập prompt', 'PROMPT_BOX_NOT_FOUND');
        setPrompt(box, req.prompt);
        logs.push({ level: 'success', message: `Đã điền prompt (${req.prompt.length} ký tự).` });
        if (req.aspectRatio) logs.push({ level: 'warn', message: `Tỉ lệ ${req.aspectRatio} và số ảnh ${req.outputCount}: chưa tự chỉnh được, hãy kiểm tra trong Flow.` });
        return { ok: true, logs };
      }
      case 'readback': {
        const data: FlowReadbackData = {
          modelLabel: readModelLabel(), aspectRatio: null, outputCount: null,
          imageCount: null, prompt: readPrompt(findPromptBox()),
        };
        logs.push({ level: 'info', message: `Đọc lại: model=${data.modelLabel ?? '?'}, prompt=${data.prompt?.length ?? 0} ký tự.` });
        return { ok: true, logs, readback: data };
      }
      case 'generate': {
        baselineSrcs.clear();
        pageImages().forEach((i) => baselineSrcs.add(i.src));
        const btn = findGenerate();
        if (!btn) throw new StepError('GENERATE_NOT_FOUND', 'Không tìm thấy nút Generate.');
        if (btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true') {
          throw new StepError('GENERATE_DISABLED', 'Nút Generate đang bị khóa (thiếu prompt/ảnh?).');
        }
        btn.click();
        logs.push({ level: 'success', message: 'Đã bấm Generate trong Flow.' });
        return { ok: true, logs };
      }
      case 'collect': {
        const end = Date.now() + req.timeoutMs;
        let found: HTMLImageElement[] = [];
        while (Date.now() < end) {
          found = pageImages().filter((i) => !baselineSrcs.has(i.src));
          if (found.length) { await sleep(2500); found = pageImages().filter((i) => !baselineSrcs.has(i.src)); break; }
          await sleep(1500);
        }
        if (!found.length) return { ok: true, logs: [{ level: 'info', message: 'Chưa thấy ảnh mới.' }], images: [], pending: true };
        const images = await Promise.all(found.map(toCollected));
        logs.push({ level: 'success', message: `Thấy ${images.length} ảnh mới, đọc được byte: ${images.filter((i) => i.base64).length}.` });
        return { ok: true, logs, images };
      }
    }
  } catch (e) {
    const code = e instanceof StepError ? e.code : 'UNEXPECTED';
    return { ok: false, code, message: e instanceof Error ? e.message : String(e), logs };
  }
}

chrome.runtime.onMessage.addListener((msg: FlowRequest, _sender, sendResponse) => {
  void handle(msg).then(sendResponse);
  return true;
});
