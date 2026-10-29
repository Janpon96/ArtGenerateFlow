# 08 — Handoff cho dev / coding agent

## 1. Prompt khởi động có thể sử dụng

```text
Bạn triển khai Flow Reference Studio từ bộ tài liệu này.

Đọc README và docs/01 đến docs/09; xem contracts, examples, reference và qa.
Đây là bộ đặc tả, chưa phải extension hoàn chỉnh. Không báo một capability đã
hoạt động chỉ vì có mock hoặc interface. Ghi mọi chỗ chưa xác minh vào
COMPATIBILITY_LEDGER và KNOWN_LIMITATIONS.

Mục tiêu: Chrome MV3 desktop, side panel + Workbench, local-first, nhiều
references có phân vai, Prompt Compiler, chọn model/tỷ lệ theo capability,
sửa vùng với compositor + kiểm tra PNG ngoài mask, queue phục hồi được.

Bắt đầu bằng G0 read-only/Assisted và tạo skeleton G1. Nếu chưa có quyền
truy cập Flow thử nghiệm, hoàn tất local core và mock, ghi G0 live là blocked,
không invent selector hoặc endpoint. Không lấy cookie/token/browser profile.

Triển khai theo thứ tự DATA/REF/PRM/CAP/IMG/FLOW/JOB/HIST/QA, tuân theo
dependencies. Mỗi thay đổi có acceptance evidence phù hợp. Chỉ viết test
cho invariant, lỗi quan trọng và tích hợp; không viết test lặp lại implementation
để tạo số lượng.

Flow UI là adapter có thể hỏng. Dùng selector đã quan sát, kiểm tra unique
target và read-back. Unknown submission luôn reconcile, không auto generate.
Đường Assisted download/import phải hoàn thành được toàn bộ workflow.

Chế độ Strict áp dụng cho canonical baseline cùng geometry và PNG đã verify.
Mọi pixel ngoài effective mask, kể cả protect, phải giữ nguyên RGBA.
Không thay thế bước này bằng câu prompt “keep everything else unchanged”.

Không tự bỏ references, đổi model, thay giá trị output, chuyển provider hoặc
chạy vòng tối ưu vô hạn. Raw prompt, compiled prompt, source map, model
requested/observed và mọi image revision phải truy vết được.

Khi bàn giao, nêu rõ: file thay đổi, chức năng dùng được, lệnh/test thực sự
đã chạy, kết quả, manual steps còn lại, known limitations và cách cài thử.
Không publish hoặc chạy batch tốn phí ngoài phạm vi được chủ dự án giao.
```

## 2. Cấu trúc repo đích

| Đường dẫn | Nội dung |
|---|---|
| `apps/extension/src/background/` | Listener, coordinator, runtime messaging |
| `apps/extension/src/content/` | Flow reader/actions/observer, binding validation |
| `apps/extension/src/workbench/` | Project, canvas, review UI |
| `apps/extension/src/sidepanel/` | Flow controls và job status |
| `packages/domain/` | Types/schema/state transitions |
| `packages/prompt-core/` | Compiler, lint, source map |
| `packages/image-core/` | Baseline, masks, mapping, composite, PNG verify |
| `packages/storage/` | IndexedDB, migration, backup |
| `packages/providers/flow-web/` | Capability registry và versioned adapter |
| `packages/providers/mock/` | Fixture scenarios, deterministic fake outputs |
| `tests/` | Unit, integration, mock E2E, live smoke có kiểm soát |
| `docs/` | Quyết định, compatibility ledger, runbook, known limitations |

## 3. Hợp đồng hoàn thành mỗi milestone

Không merge milestone chỉ có UI nút bấm không có hành vi hoặc nút sinh ảnh trỏ tới mock nhưng ghi “Flow”. Mock mode phải có nhãn rõ. Mỗi milestone ghi **đã chạy / chưa chạy / blocked / không thuộc phạm vi**. Nếu scope giảm, cập nhật plan và UI trước, không âm thầm coi fallback thủ công là full automation.

Nguyên tắc chốt kiến trúc: local core chạy được trước; adapter Flow có thể thay thế; unknown được biểu diễn trong schema; state side effect được journal; strict export được kiểm tra từ file bytes.
