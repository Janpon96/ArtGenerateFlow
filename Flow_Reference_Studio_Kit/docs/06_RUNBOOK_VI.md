# 06 — Runbook triển khai và vận hành

## 1. Phân biệt hai bộ lệnh

Bộ tài liệu hiện tại có mã tham chiếu có thể chạy:

```bash
node --test reference/mask_core.test.mjs
```

Các lệnh `pnpm` dưới đây là **hợp đồng script cho repo extension sẽ được tạo ở G1**, không phải lệnh đã có trong bộ tài liệu này. Người triển khai phải tạo scripts tương ứng và chứng minh chúng chạy trước khi ghi “pass”.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:e2e:mock
pnpm build:extension
pnpm package:extension
```

Dev mode có thể cung cấp `pnpm dev`; package production không dùng script/HMR từ mạng. `test:e2e:flow` là lệnh tùy chọn chạy có giám sát trên tài khoản được phép thử, có hạn mức số generation rõ; không mặc định chạy ở CI public.

## 2. G0 — checklist khảo sát Flow

Chuẩn bị Chrome profile thử nghiệm, tài khoản người dùng có quyền dùng Flow, một project riêng và 4 ảnh test không nhạy cảm. Chọn giới hạn số lần tạo thử trước buổi test. Không sửa project thật đang có công việc.

1. Mở Flow bằng URL chính thức; ghi origin/route sau redirect, locale và ngày.
2. Liệt kê tên model trong **Image mode**; xác định model nào selectable/disabled. Đọc ratio, resolution và output count nếu hiện.
3. Thử upload 2 rồi 4 refs; ghi thứ tự, thumbnail phản ánh file nào, lỗi file type/size nếu thấy. Không spam để dò giới hạn.
4. Nhập một prompt ngắn, chọn đúng model, bấm Generate một lần; quan sát dấu hiệu request accepted, trạng thái chạy và card kết quả.
5. Tải file đầu ra bằng UI; so kích thước file thật với thumbnail và option đã chọn.
6. Thử một local edit bằng lasso/drawing nếu hiện. Ghi rõ có/không có cách nhập mask file; không suy từ việc lasso xuất hiện.
7. Thử DOM read-only trước; chỉ thử action khi target duy nhất. Upload synthetic bị chặn thì ghi manual_required.
8. Đóng/mở lại tab sau generation test đã được phép; thử reconnect ở trạng thái không gây submit mới.
9. Lặp case kiểm tra đọc UI ở locale còn lại nếu hỗ trợ EN/VI; không cần tạo ảnh thêm nếu chỉ đọc labels.
10. Lưu `compatibility-ledger.json`, selector pack, fixture đã khử dữ liệu riêng tư và known limitations.

Kết luận G0 phải nêu rõ chức năng nào chạy Assisted và chức năng nào tự động. Không ghi “Flow integrated” chỉ vì mở tab và điền được prompt.

## 3. Thiết lập repo extension

1. Tạo cấu trúc modules theo technical spec; đưa contracts vào `packages/domain` và bật strict TypeScript.
2. Pin dependencies/lockfile, tạo scripts nêu trên, CI offline-mock, CSP và manifest tối thiểu.
3. Tạo mock provider với các kịch bản accepted/rejected/unknown, delayed output, unavailable model và lost tab.
4. Làm project/refs/prompt trước; lưu và khôi phục draft qua restart.
5. Làm mask/compositor với unit tests; bổ sung PNG round-trip, alpha, ICC và EXIF integration tests.
6. Cài unpacked bằng `chrome://extensions` → Developer mode → Load unpacked → thư mục build đã sinh. Kiểm tra permissions thực tế.
7. Kết nối Flow, dùng Assisted end-to-end; sau đó bật từng DOM capability đã qua G0.
8. Chạy QA và tạo release evidence. Không bỏ test failing để kịp demo.

## 4. SOP tạo ảnh hằng ngày

Mở project → kiểm tra tab/tài khoản → chọn refs và role → chọn model/tỷ lệ → nhập brief/style → xem compiled prompt và input order → bấm Tạo/Chuẩn bị → thực hiện bước Flow còn cần thao tác → chọn/import output → review → lưu version.

Nếu Flow thay đổi model sau một tùy chọn khác, dừng trước submit để cập nhật intent. Nếu đổi trong quá trình generation và chỉ thấy lúc nhận kết quả, ghi actual model nếu biết; không sửa lịch sử requested model cho khớp giả.

## 5. SOP sửa vùng

Chọn base version → xem baseline → vẽ allowed mask và protect → nhập thay đổi cụ thể → chọn refs tối thiểu cần thiết → kiểm tra context và strategy → tạo candidate → kiểm tra alignment → composite → verify PNG → review nội dung → lưu.

Thao tác regenerate tạo child job. Nếu chỉ đổi mask/composite sau khi đã có candidate và không cần model tạo lại, cho phép re-composite cục bộ trên revision mới; ghi provenance đã tái dùng candidate, không tính thành generation mới.

## 6. Xử lý sự cố

| Mã / hiện tượng | Thao tác an toàn | Không làm |
|---|---|---|
| `AUTH_REQUIRED` | Pause, người dùng đăng nhập trong Flow, probe lại | Đọc cookie/profile để đăng nhập hộ |
| `MODEL_UNAVAILABLE` | Giữ draft, tải lại model list, người dùng chọn model khác | Tự fallback model |
| `UI_CHANGED` | Dừng action, chuyển Assisted, thu diagnostic đã redact | Đổi sang tọa độ click cố định để tiếp tục |
| `UPLOAD_UNVERIFIED` | So count/order, người dùng upload lại file còn thiếu nếu xác nhận chưa có | Upload lại toàn bộ không kiểm tra |
| `SUBMIT_UNKNOWN` | Vào reconcile, tìm card kết quả đúng, hỏi user chọn nếu mơ hồ | Bấm Generate lần nữa tự động |
| `QUOTA_EXHAUSTED` | Pause; kiểm tra trong Flow; giữ queue | Chuyển tài khoản/khẳng định giờ reset suy đoán |
| `USER_ACTION_REQUIRED` | Hiện bước cụ thể trong Flow; resume khi hoàn tất | Cố vượt xác minh của website |
| `RESULT_AMBIGUOUS` | Chọn output tương ứng hoặc import file | Lấy ảnh mới nhất của project |
| `DOWNLOAD_BLOCKED` | Download thủ công rồi import full-resolution file | Dùng screenshot/thumbnail như ảnh gốc |
| `ALIGNMENT_REQUIRED` | Overlay so sánh, căn chỉnh candidate hoặc tạo lại | Resize/reframe baseline |
| `STRICT_VERIFY_FAILED` | Giữ candidate, khóa Strict, so decoder/encoder/profile/dimensions | Nới tolerance rồi gắn nhãn pixel-exact |
| `STORAGE_FULL` | Export backup, xóa cache có thể tái tạo, giải phóng theo lựa chọn | Xóa refs/history chưa được chọn |
| `CONTENT_REJECTED` | Hiện lý do provider nếu có, cho sửa brief | Auto-rewrite để vượt bộ lọc |

## 7. Phục hồi crash/reload

Khi extension khởi động lại: migration check → đọc event journal → khôi phục UI drafts → đánh dấu binding cũ cần reconnect → lấy lock mới → reconcile các job đã submit hoặc không rõ.

PREPARING có thể chuẩn bị lại sau khi đọc upload state. SUBMITTING không được tự quay về READY. OBSERVING tìm lại card/result nếu có identifier ổn định; thiếu bằng chứng thì user chọn. VERIFYING có đủ local inputs thì chạy lại compositor/encoder deterministic. COMPLETED không tạo lại ảnh.

AWAITING_USER đã mở bước bấm Generate trong Assisted cũng phải reconcile sau reconnect: người dùng có thể đã gửi trong Flow nhưng chưa xác nhận ở Studio.

Nếu browser đóng, không hứa generation bị hủy. Khi mở lại, user nhìn thấy “Cần kiểm tra kết quả Flow” cho job chưa kết luận. Local close không phải provider cancellation.

## 8. Phát hành và rollback

Trước release: chạy unit/integration/mock E2E, QA thủ công, permissions review theo chức năng, kiểm tra bundle không có secrets/remote code, thử install mới và upgrade DB. Tạo checksum bundle, changelog, tương thích Flow ngày nào và tính năng manual còn lại.

Phát hành pilot nội bộ trước, thu tỷ lệ pass thật, sau đó đóng gói Chrome Web Store khi chủ sản phẩm quyết định phát hành. Bản public phải có mô tả dữ liệu/permissions đúng thực tế. Đây là bước phát hành sản phẩm của đội triển khai, không phải tác vụ đã làm trong bộ docs.

Nếu regression adapter: disable DOM automation, giữ Assisted và local editing. Với store rollout, rollback thường thực hiện bằng bản mới mang code đã sửa/revert và version tăng, không dựa vào downgrade tự động. Schema mới phải tương thích đọc ngược hoặc có migration restore từ backup; không hạ version DB bằng cách xóa dữ liệu.

## 9. Bảo trì

Kiểm tra smoke read-only sau thay đổi Flow/Chrome; chạy generation test khi thay adapter hoặc có lỗi chưa giải quyết. Không tiêu credit hằng ngày chỉ để xác nhận UI không đổi. Pin source evidence ngày kiểm tra; model/cost registry cập nhật theo observation, không phát hành hằng số vô thời hạn.

Diagnostic log: extensionVersion, adapterVersion, browser version, locale, error code, state transitions, timing, hashes rút gọn, geometry và capability evidence. Không chứa prompt đầy đủ, ảnh, email, cookies hay token. Support có thể yêu cầu người dùng xuất gói đã review nếu cần điều tra.
