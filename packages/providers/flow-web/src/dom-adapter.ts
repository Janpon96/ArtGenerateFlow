import type {
  Asset, ConnectionBinding, GenerationJob, Id, PreparedJob, ProviderAdapter,
  ReadBack, ReconcileOutcome, SubmitOutcome, CapabilitySnapshot,
} from '@frs/domain';
import { FlowWebAssistedAdapter } from './index';
import {
  modelLabelsMatch,
  type FlowCollectedImage, type FlowImagePayload, type FlowRequest, type FlowResponse, type FlowStepLog,
} from './protocol';

export const FLOW_DOM_ADAPTER_VERSION = 'flow-web-dom/0.1.0 (content script, selectors unverified)';

export interface DomAdapterDeps {
  /** Sends one request to the content script on the Flow tab. */
  send(req: FlowRequest): Promise<FlowResponse>;
  /** Loads the job's input images in Source Map order. */
  loadImages(assetIds: Id[]): Promise<FlowImagePayload[]>;
  /** Stores one collected image and returns its Asset. */
  saveImage(img: FlowCollectedImage, job: GenerationJob, index: number): Promise<Asset>;
  /** Receives every step log from the content script. */
  onLog?(jobId: Id, log: FlowStepLog): void;
  collectTimeoutMs?: number;
}

/**
 * Flow adapter that drives the Flow tab through the content script.
 * prepare() only fills the form (reversible). submit() is the only call that presses Generate,
 * and the orchestrator journals the attempt before calling it. It never retries.
 * Nothing here has been checked against the live Flow UI.
 */
export class FlowWebDomAdapter implements ProviderAdapter {
  private readonly assisted = new FlowWebAssistedAdapter();
  private lastReadback: ReadBack | null = null;

  constructor(private readonly deps: DomAdapterDeps) {}

  private emit(jobId: Id, logs: FlowStepLog[]): void {
    for (const l of logs) this.deps.onLog?.(jobId, l);
  }

  private async call(jobId: Id, req: FlowRequest): Promise<FlowResponse> {
    let res: FlowResponse;
    try {
      res = await this.deps.send(req);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.deps.onLog?.(jobId, { level: 'error', message: `Không gọi được content script: ${message}` });
      return { ok: false, code: 'NO_CONTENT_SCRIPT', message, logs: [] };
    }
    this.emit(jobId, res.logs);
    if (!res.ok) this.deps.onLog?.(jobId, { level: 'error', message: `[${res.code}] ${res.message}` });
    return res;
  }

  async probe(binding: ConnectionBinding): Promise<CapabilitySnapshot> {
    const snap = await this.assisted.probe(binding);
    return { ...snap, adapterVersion: FLOW_DOM_ADAPTER_VERSION };
  }

  async prepare(job: GenerationJob): Promise<PreparedJob> {
    const prepared = await this.assisted.prepare(job);
    const images = await this.deps.loadImages(job.intent.orderedAssetIds);
    const res = await this.call(job.id, {
      type: 'fill',
      model: job.intent.requestedModelLabel,
      aspectRatio: job.intent.aspectRatio,
      outputCount: job.intent.outputCount,
      prompt: job.intent.prompt.compiledText,
      images,
    });
    const back = await this.call(job.id, { type: 'readback' });
    const uncertainties: string[] = [];
    let ok = res.ok && back.ok;
    if (!res.ok) uncertainties.push(`Điền form thất bại: [${res.code}] ${res.message}`);
    if (!back.ok) uncertainties.push(`Đọc lại thất bại: [${back.code}] ${back.message}`);
    const data = back.ok ? back.readback : undefined;
    const want = job.intent.requestedModelLabel;
    if (data && want && (!data.modelLabel || !modelLabelsMatch(data.modelLabel, want))) {
      ok = false;
      uncertainties.push(`Model trong Flow là "${data.modelLabel ?? 'không đọc được'}", yêu cầu "${want}".`);
    }
    if (data && data.prompt !== null && data.prompt.trim() !== job.intent.prompt.compiledText.trim()) {
      ok = false;
      uncertainties.push('Prompt trong Flow khác với prompt đã biên dịch.');
    }
    uncertainties.push('Tỉ lệ khung hình và số ảnh chưa được đọc lại tự động, hãy kiểm tra trong Flow.');
    this.lastReadback = {
      promptHash: ok ? job.payloadHash : null,
      modelLabel: data?.modelLabel ?? null,
      aspectRatio: null, resolutionLabel: null, outputCount: null, orderedAssetIds: null,
      evidence: 'observed_ui', matchesIntent: ok, uncertainties,
    };
    return prepared;
  }

  async readBack(_prepared: PreparedJob): Promise<ReadBack> {
    return this.lastReadback ?? {
      promptHash: null, modelLabel: null, aspectRatio: null, resolutionLabel: null, outputCount: null,
      orderedAssetIds: null, evidence: 'observed_ui', matchesIntent: false, uncertainties: ['Chưa đọc lại được Flow.'],
    };
  }

  async submit(prepared: PreparedJob, attemptId: Id): Promise<SubmitOutcome> {
    const res = await this.call(prepared.jobId, { type: 'generate' });
    if (res.ok) return { status: 'accepted', providerJobId: attemptId, evidence: 'Content script bấm Generate; chưa xác nhận Flow đã nhận.' };
    // The button was not found or was disabled before any click: nothing reached Flow.
    if (res.code === 'GENERATE_NOT_FOUND' || res.code === 'GENERATE_DISABLED') {
      return { status: 'rejected', code: res.code, message: res.message };
    }
    return { status: 'unknown', reason: `[${res.code}] ${res.message}` };
  }

  async reconcile(job: GenerationJob): Promise<ReconcileOutcome> {
    const res = await this.call(job.id, { type: 'collect', timeoutMs: 3000 });
    if (!res.ok) return { status: 'ambiguous', reason: `[${res.code}] ${res.message}` };
    if (res.images && res.images.length) {
      return { status: 'found', resultLocators: res.images.map((i) => i.src), evidence: 'Thấy ảnh mới trên trang Flow.' };
    }
    return { status: 'ambiguous', reason: 'Chưa thấy ảnh mới. Kiểm tra trong Flow trước khi làm gì tiếp.' };
  }

  async collect(job: GenerationJob): ReturnType<ProviderAdapter['collect']> {
    const res = await this.call(job.id, { type: 'collect', timeoutMs: this.deps.collectTimeoutMs ?? 120_000 });
    if (!res.ok) return { status: 'manual_import_required', reason: `[${res.code}] ${res.message}` };
    const imgs = res.images ?? [];
    if (res.pending || imgs.length === 0) {
      return { status: 'manual_import_required', reason: 'Chưa thấy ảnh mới. Đợi Flow tạo xong rồi thử lại, hoặc nhập file thủ công.' };
    }
    const readable = imgs.filter((i) => i.base64);
    if (readable.length === 0) {
      return { status: 'manual_import_required', reason: 'Thấy ảnh nhưng trình duyệt chặn đọc byte. Hãy tải ảnh từ Flow và nhập thủ công.' };
    }
    const assets: Asset[] = [];
    for (let i = 0; i < readable.length; i++) assets.push(await this.deps.saveImage(readable[i]!, job, i));
    return { status: 'collected', assets, provenance: 'observed_ui' };
  }

  async cancel(_job: GenerationJob): ReturnType<ProviderAdapter['cancel']> {
    return { status: 'unsupported', evidence: 'Chưa hỗ trợ hủy từ extension. Hủy trong Flow.' };
  }
}
