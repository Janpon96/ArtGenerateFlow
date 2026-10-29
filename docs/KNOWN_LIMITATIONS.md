# Known limitations

Trạng thái: cập nhật theo từng bước triển khai. Mục nào chưa chạy thật thì ghi rõ.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| G0 live với Flow | **blocked** | Không có truy cập Flow thật. Xem `COMPATIBILITY_LEDGER.json`. |
| Selector / endpoint Flow | Không có | Không bịa. Adapter `flow-web` chỉ ở chế độ Assisted. |
| Tự bấm Generate, tự upload vào Flow | Ngoài phạm vi | Người dùng tự bấm Generate đúng một lần. |
| Model, tỉ lệ, độ phân giải của Flow | Chưa xác minh | Mọi capability là `unknown`; không chọn model chưa biết. |
| Native lasso / import mask vào Flow | Chưa xác minh | Mask cục bộ vẫn quyết định kết quả Strict. |
| PNG có ICC profile hoặc 16-bit | Chặn (PNG-02) | Strict bị từ chối thay vì chuyển đổi lặng lẽ. |
| Benchmark hiệu năng | NOT_RUN | Chưa đo trên máy thật. |
| Mock provider | Chỉ để kiểm thử | Luôn gắn nhãn MOCK; không chứng minh Flow hoạt động. |
| Giới hạn 24 ref / 20 MiB / 24 MP, timeout, cache 10 phút | Đề xuất trong docs | Không phải sự thật về Flow. |
| Nạp tiện ích vào Chrome thật | NOT_RUN | Chưa mở bằng trình duyệt. Cần smoke test thủ công (xem README). |
| UI Workbench | Tối thiểu | TypeScript thuần, không React. Có: biên dịch prompt, Strict (PNG, vùng chữ nhật), job Assisted, lịch sử job, xuất backup. Chưa có: nhập ảnh tham chiếu vào job, nhập kết quả Flow thành version, cây phiên bản, nhập backup, mask nhiều lớp/protect trên UI. |
| Orchestrator sau RESULT_READY | Chưa có bước collect | Chuyển trạng thái đã có trong `job-state.ts`; kết quả Assisted phải tự tải và nhập tay. |
| Codec PNG | Giới hạn | Chỉ 8-bit RGB/RGBA, không interlace. Nguồn khác bị chặn khỏi Strict. |
| Lint | TS-aware qua TS 6 | `typescript` được alias sang `@typescript/typescript6` cho typescript-eslint. `tsc` (typecheck) vẫn là TS 7.0.2. |
| pnpm build scripts | Không duyệt | `pnpm install` báo `ERR_PNPM_IGNORED_BUILDS` cho esbuild (exit 1). esbuild vẫn chạy, build đạt. |
