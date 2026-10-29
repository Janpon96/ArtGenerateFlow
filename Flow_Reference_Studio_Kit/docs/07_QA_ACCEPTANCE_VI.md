# 07 — Kiểm thử và tiêu chí nghiệm thu

## 1. Phân lớp kiểm thử

| Lớp | Kiểm tra | Chạy khi |
|---|---|---|
| Unit | Prompt/source map, constraints, state transitions, geometry, composite, outside diff | Mọi thay đổi core |
| Integration | IndexedDB restart/migration, PNG encode/decode, EXIF/profile, chunk upload, permissions | Thay storage/image/bridge |
| E2E mock | Tạo ảnh, edit, retry/cancel, crash, reconnect, unknown result | CI và release |
| E2E Flow có giám sát | Select model, refs, generate, collect, edit, UI locale | Adapter mới/thay đổi hoặc lỗi thực tế |
| Review nội dung | Bám refs, style, composition, vùng sửa, seam | Benchmark release và user review |

Không coi mock pass là bằng chứng Flow thật hoạt động. Không coi nhìn giống là bằng chứng mọi pixel ngoài mask bằng nhau.

## 2. Cổng phát hành bắt buộc

1. **Input fidelity:** Không làm mất, đổi hoặc tráo ref được chọn. Settings requested/observed khác nhau phải hiện và chặn hoặc được user cập nhật intent trước submit.
2. **Submit integrity:** Crash trước click, sau click trước ACK, sau ACK, reload content script, mở 2 Workbench và mất lock không được làm auto-submit thêm một lần.
3. **Strict preservation:** Toàn bộ fixtures chuẩn PNG round-trip có `outsideChangedPixels=0`; mask mismatch/dimension mismatch bị chặn. Nếu chưa có PNG integration thì chưa được phát hành nhãn Strict.
4. **Recovery:** Restart giữ draft, refs, mask, queue và result lineage. Không giả “đã hủy” khi Flow có thể còn chạy.
5. **Capability truthfulness:** Không đặt hardcoded model/default/limit thay cho việc xác nhận tài khoản. Native lasso và native mask import là hai capability riêng.
6. **Data integrity:** Export/import backup checksum đúng, không ghi đè original, migration có đường phục hồi.
7. **Usability:** Người chưa xem code hoàn tất một generation và một edit theo runbook, biết khi nào cần thao tác trong Flow.

Lỗi gây submit trùng, mất dữ liệu, xuất Strict sai, upload nhầm ảnh hoặc nhận nhầm output là lỗi chặn release bất kể số test khác pass.

## 3. Test matrix rút gọn

| ID | Tình huống | Kết quả mong đợi |
|---|---|---|
| REF-01 | Upload 4 refs rồi đổi thứ tự | Manifest/prompt/Flow thumbnail order thống nhất hoặc bắt user xác nhận |
| REF-02 | Có 24 refs local, provider chỉ chấp nhận số ít hơn | Chọn subset rõ ràng, không bỏ refs âm thầm |
| REF-03 | Hai nhân vật, mỗi người có outfit ref riêng | Source map giữ subjectKey; không trộn outfit |
| REF-04 | File sai MIME, hỏng, quá lớn, ảnh động | Từ chối với lý do; không mất các refs đã import |
| PRM-01 | Giữ tóc đen + yêu cầu tóc đỏ trong structured fields | `CONFLICT_TRAIT`; chưa submit |
| PRM-02 | Recompile cùng input/version | Text/hash/source map giống nhau |
| PRM-03 | Exact text tiếng Việt, dấu, tên riêng | Không dịch/sửa chuỗi exact text |
| CAP-01 | Model biến mất giữa prepare/submit | Chặn trước submit, giữ draft |
| CAP-02 | Auto Agent đang bật nhưng user chọn model cụ thể | Chuyển standard khi được hỗ trợ; đọc lại, nếu không thì manual |
| CAP-03 | Resolution/maxRefs chưa biết | Hiển thị unknown; không giả thông số |
| DOM-01 | Selector khớp 0 hoặc 2 buttons | Dừng action; không click theo vị trí |
| DOM-02 | Content script bị reload giữa upload | Reconcile uploaded refs trước tiếp tục |
| JOB-01 | Crash ngay sau Generate trước ACK | `NEEDS_RECONCILIATION`; không auto retry |
| JOB-02 | Mở 2 Workbench và 2 tab cùng profile | Chỉ binding/coordinator hợp lệ được submit |
| JOB-03 | Cancel khi đang tạo | Ghi kết quả cancel thực tế; không hứa hoàn credit |
| JOB-04 | Model/quota/content rejection | State/reason đúng; không vòng retry vô hạn |
| OUT-01 | Hai job thủ công khác xuất hiện trong Flow | Không nhận ảnh mới nhất bừa; user chọn khi ambiguous |
| OUT-02 | Chỉ lấy được thumbnail | Không gắn full-resolution; yêu cầu file tải về |
| MSK-01 | Mask rỗng hoặc protect hết | Chặn generation/edit vô nghĩa |
| MSK-02 | Mask 1 pixel, nhiều vùng rời nhau, có lỗ | Composite chính xác, outside invariant pass |
| MSK-03 | Feather lớn/chạm biên ảnh/protect giữa vùng | Mọi A=0 đều có m=0; không leak |
| MSK-04 | Zoom/pan/letterbox/DPR/EXIF rotation | Vùng chọn nằm đúng trên ảnh canonical |
| MSK-05 | Candidate dimension khác, crop padding | Cần mapping hợp lệ; không resize baseline |
| MSK-06 | User thay mask trong lúc chờ | Job dùng mask revision cũ; không ghép vào draft mới |
| PNG-01 | Alpha=0 có RGB ẩn, alpha bán trong, sRGB | Encode/decode final vẫn giữ bytes ngoài A |
| PNG-02 | ICC/wide-gamut/16-bit | Chuẩn hóa có hiển thị hoặc chặn, không false Strict |
| PNG-03 | JPEG export/resize sau strict | File dẫn xuất không còn nhãn pixel-exact |
| DB-01 | Hết quota/đóng browser giữa lưu | Transaction không tạo project hỏng; có hướng dẫn khôi phục |
| DB-02 | Backup import hỏng/hash sai/zip path traversal | Reject, project hiện có không bị sửa |
| SEC-01 | Page gửi message giả yêu cầu đọc asset/submit | Reject sender/schema/binding sai |
| SEC-02 | CDN URL giả/redirect khác host | Reject fetch; không proxy URL tùy ý |
| UX-01 | Luồng đầy đủ Assisted | User biết bước nào đã làm/chưa làm; tạo+edit+export hoàn thành |

Ma trận này cũng có ở `qa/UAT_CASES.csv` để đội QA đánh trạng thái, người test và evidence. Dòng chưa chạy là `NOT_RUN`, không tự đổi thành pass theo mô tả.

## 4. Benchmark bám prompt và refs

Tạo **12 brief chuẩn**: 3 nhân vật, 3 background/isometric, 2 sản phẩm, 4 edit cục bộ. Mỗi brief có ref manifest và checklist trọng yếu. So sánh prompt tự do baseline với prompt compiled, cùng model/settings/refs, thứ tự chạy xen kẽ để giảm ảnh hưởng thời điểm.

Chạy 2 lượt cho mỗi điều kiện nếu hạn mức cho phép: 48 output ở cấu hình 1 output/job; ít hơn thì báo rõ cỡ mẫu. Không tự thực hiện benchmark có tiêu credit khi chưa thiết lập hạn mức thử. Đánh giá mù điều kiện nếu có 2 reviewer; bất đồng được ghi thay vì chọn điểm cao hơn.

| Tiêu chí | Điểm 0–4 | Trọng số cho generation |
|---|---|---:|
| Đúng identity/traits/object | 0: sai đối tượng; 4: đúng các trait quan sát được | 30% |
| Bám action/brief | 0: sai mục tiêu; 4: đạt checklist | 25% |
| Bố cục và quan hệ không gian | 0: sai layout; 4: đúng ràng buộc | 20% |
| Style/palette | 0: sai style; 4: phù hợp ref style | 15% |
| Chất lượng thị giác | 0: lỗi nặng; 4: không lỗi đáng kể ở kích thước sử dụng | 10% |

Mục tiêu pilot đề xuất: ít nhất 80% brief đạt các yêu cầu trọng yếu và median rubric ≥3/4; compiled không giảm tỉ lệ đạt so với baseline. Đây là **ngưỡng nghiệm thu mong muốn**, chưa là kết quả đã đo. Báo số lượng tuyệt đối, số lượt tạo lại, tổng output/credit thực tế nếu biết và các failure pattern.

Edit thêm 2 tiêu chí: thay đổi cục bộ đúng brief; seam/alignment chấp nhận được. Pixel invariant là điều kiện binary riêng, không bù bằng điểm thẩm mỹ cao. AI/VLM scoring sau này có thể gợi ý thứ tự review nhưng không thay test pixel hoặc phán quyết con người.

## 5. Hồ sơ release evidence

`build-info.json`, checksum bundle, browser/OS, adapter version, test summary, UAT CSV, benchmark summary, known limitations, feature flags, schema migration notes. Không đưa test account secrets hoặc ảnh riêng tư vào release artifacts.

Mã tham chiếu kèm bộ này có test riêng; báo cáo kết quả của nó chỉ chứng minh core algorithm trong môi trường Node, không bao gồm Chrome, Flow, PNG, color profile hoặc chất lượng ảnh AI.
