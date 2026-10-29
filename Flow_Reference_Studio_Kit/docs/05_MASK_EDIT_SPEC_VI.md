# 05 — Chọn vùng và bảo toàn phần ngoài

## 1. Cam kết đúng phạm vi

**Strict Region Edit:** Với cùng baseline đã chuẩn hóa, cùng kích thước và cùng lưới pixel, mọi pixel ngoài vùng được phép sửa trong file PNG xuất phải bằng baseline ở cả bốn kênh RGBA.

Cam kết này không có nghĩa model sẽ tạo đúng mọi chi tiết trong mask; cũng không có nghĩa file đầu ra giống byte-for-byte file JPEG gốc. Baseline là ảnh đã decode, xử lý EXIF và chuẩn hóa về sRGB RGBA8, được xem trước và lưu bất biến. Original bytes vẫn được giữ để truy xuất.

Google đã công bố chỉnh ảnh bằng lasso/drawing trong Flow [S03]. Tài liệu API Gemini cũng có ví dụ semantic masking bằng ngôn ngữ [S10]. Các nguồn đó không được dùng làm bằng chứng pixel-lock cho sản phẩm này. Pixel-lock là tính chất của pipeline local và file export đã kiểm tra.

## 2. Canonical baseline

Import original → kiểm tra MIME/bytes/dimensions → decode → áp dụng EXIF đúng một lần → chuyển profile về sRGB → canonical RGBA8 → lưu normalized PNG + metadata + pixelHash.

Mọi canvas preview, mask và job edit dùng kích thước sau EXIF. Không tạo mask trên thumbnail rồi lấy tọa độ thumbnail làm tọa độ gốc. Với wide-gamut/16-bit/HDR, MVP hiển thị rằng baseline đang chuẩn hóa về SDR sRGB 8-bit; giữ original. Nếu chưa có conversion đáng tin cậy, chặn Strict cho loại đó và hướng dẫn dùng PNG sRGB.

Alpha cần được xử lý rõ: lưu/copy canonical RGBA bytes, giữ cả RGB ở pixel alpha=0 của baseline. Canvas chỉ để xem và vẽ mask; không round-trip toàn ảnh qua `drawImage` sau composite vì có thể premultiply/unpremultiply hoặc đổi màu. Encoder PNG lấy trực tiếp byte array đã ghép. Codec được bundle và pin version.

## 3. Tọa độ và mask

`U` = vùng người dùng cho phép sửa; `P` = vùng protect. Cả hai có đúng W×H, binary, tọa độ pixel gốc. Vùng hiệu lực:

```text
A(x,y) = U(x,y) AND NOT P(x,y)
```

Protect luôn thắng. Nhiều vùng rời nhau, lỗ mask và cạnh chạm biên ảnh phải hoạt động. Lasso dùng quy tắc fill xác định (even-odd) và rasterize trên lưới gốc. Pixel mask quyết định bằng sample tại tâm pixel; overlay có anti-alias chỉ để xem, không âm thầm nới A.

Pointer mapping: client coordinate → bỏ offset canvas/CSS border → nghịch đảo transform pan/zoom/rotation preview → pixel gốc. DevicePixelRatio chỉ tác động backing store render, không nhân thêm lần nữa vào tọa độ ảnh. Khi fit-to-screen phải trừ letterbox. Test ở zoom 25%, 100%, 400% và DPR 1/1.25/2.

Undo/redo lưu thao tác nét và snapshot định kỳ; mỗi mask revision có hash. Mask gắn với `basePixelHash`. Đổi baseline hoặc orientation phải tạo lại/chuyển mask có mapping rõ; không tái dùng mask cũ im lặng.

## 4. Feather không lan ra ngoài

Mặc định 0–8 px theo pixel gốc, tùy ảnh. Feather **chỉ vào trong** A, kể cả biên protect. Với khoảng cách d từ pixel được chọn tới vùng không được chọn, tạo trọng số m trong [0,1] tăng dần từ biên vào trong; mọi pixel A=0 bắt buộc m=0.

```text
if A == 0: m = 0
else if featherRadius == 0: m = 1
else: m = smoothstep(0, featherRadius, inwardDistance)
```

Production nên dùng distance transform đủ mượt quanh đường chéo. Mã tham chiếu đi kèm dùng khoảng cách lưới 4-neighbor đơn giản để minh họa invariant, không phải chuẩn chất lượng brush cuối cùng. Không blur rồi để trọng số lọt ra ngoài mask. Nếu mask quá nhỏ để tạo vùng lõi, cho preview và đề xuất giảm feather; không tự mở rộng.

## 5. Các strategy sinh candidate

| Strategy | Điều kiện | Cách dùng | Giới hạn |
|---|---|---|---|
| Native Flow region edit | Lasso có trong UI; thao tác được xác nhận | Chọn vùng trong Flow, mô tả sửa, thu candidate | Không giả định có endpoint nhận bitmap mask; vẽ tay nếu cần |
| Crop context patch | Mask cục bộ, cần phần xung quanh để model hiểu | Crop bbox+padding; gửi crop và refs; lấy patch về map vào ảnh gốc | Cần giữ framing/căn chỉnh; model có thể biến đổi geometry |
| Full-frame candidate | Cần bối cảnh toàn ảnh hoặc native edit không sẵn | Gửi base toàn ảnh và mô tả vùng; ghép chỉ phần mask | Tốn xử lý hơn, không đảm bảo model tập trung đúng vùng |

Native selection trong Flow và mask chính xác local không cần trùng từng pixel để bảo toàn ngoài vùng; **A local luôn quyết định phần được dùng cuối cùng**. Nhưng nếu selection Flow quá khác, chất lượng trong vùng có thể không đạt. UI cho người dùng xem cả hai ranh giới nếu có dữ liệu; không tuyên bố đồng bộ khi chưa xác minh.

### 5.1 Crop context

Lấy bbox của A rồi thêm padding mặc định 15% cạnh dài của bbox, clamp trong ảnh. Padding là ngữ cảnh gửi model, **không tăng vùng được sửa**. Cho người dùng tăng context để lấy đủ object/shadow/đường phối cảnh.

Lưu rectangle `(x0,y0,w,h)`, actual upload size, padding và mapping. Nếu chuẩn bị resize/pad cho provider ratio, lưu đầy đủ scale và padding. Sau khi nhận patch: kiểm tra shape → bỏ padding theo mapping → resample **candidate** về crop size → đặt vào tọa độ gốc. Không resample baseline.

Nếu kết quả đổi góc nhìn/zoom/silhouette làm mất khả năng căn chỉnh, dừng ở review. Có thể thêm công cụ căn chỉnh candidate bằng affine transform, phải lưu transform; chỉ biến đổi candidate. Automated registration là tính năng sau với confidence và preview, không phải bước tự sửa mặc định.

### 5.2 Guide image

Guide overlay có thể giúp mô tả vùng khi provider không nhận mask. Nó là derived asset riêng có nhãn “hướng dẫn”; chỉ gửi nếu người dùng chọn. Đồng thời gửi base sạch nếu provider cho phép. Compiler nhắc không vẽ lại outline. Không coi guide image là native mask và không dùng guide làm baseline composite.

## 6. Compositor

Với ảnh opaque:

```text
O(x,y) = I(x,y)                         nếu A(x,y)=0
O(x,y) = (1-m)*I(x,y) + m*G(x,y)        nếu A(x,y)=1
```

`I` là baseline, `G` là candidate đã map; O là kết quả. Nhánh A=0 sao chép **nguyên bốn byte** từ baseline, không chạy color conversion, blending hay rounding. Alpha hỗ trợ crossfade trên premultiplied color rồi chuyển về straight RGBA cho các pixel đang blend. Với m=0 copy baseline, m=1 copy candidate để tránh sai số không cần thiết. Pixel alpha=0 trong vùng blend có quy tắc deterministic.

Để seam tự nhiên có thể bổ sung color matching hoặc gradient blend trong A ở phiên bản sau. Bất kỳ thuật toán nào cũng phải bị giới hạn bởi A và chạy verifier; không được phát tán sửa màu ra toàn ảnh. Trường hợp bóng/ánh sáng phải lan ra ngoài cần người dùng mở mask, không “tự sửa cho đẹp”.

## 7. Verify file xuất

1. Kiểm tra base/candidate/mask cùng geometry hoặc có mapping hợp lệ; payload hash khớp job.
2. Composite ra byte array O; kiểm tra ngoài A bằng I.
3. Encode PNG lossless, đặt color metadata thống nhất với baseline.
4. Decode **chính bytes PNG sẽ lưu** bằng codec chuẩn của pipeline.
5. Kiểm tra W/H, RGBA format, pixel hash và diff ngoài A. Không so screenshot hiển thị.
6. Nếu pass, lưu report cùng output fileHash; nếu bytes file thay đổi sau đó report mất hiệu lực.

Chỉ số bắt buộc:

```text
outsidePixelCount
outsideChangedPixels
maxOutsideChannelDelta
basePixelHash
maskHash
candidatePixelHash
outputPixelHash
outputFileHash
decoderVersion / encoderVersion / normalizationVersion
verifiedAt
```

Điều kiện pass: dimensions bằng baseline, `outsideChangedPixels == 0` và `maxOutsideChannelDelta == 0`. Protected pixels được tính vào outside. Mask full-image làm outsidePixelCount=0: báo “Sửa toàn ảnh”, không quảng bá giữ nguyên phần ngoài vì không có phần ngoài để kiểm tra.

Nếu source/codec làm mất RGB ẩn ở alpha=0 hoặc color conversion, sửa pipeline/đổi chuẩn baseline có hiển thị trước; không nới tolerance thành “gần như bằng” mà vẫn gọi Strict. JPEG xuất là bản dẫn xuất: nén mất dữ liệu có thể đổi pixel ngoài mask, nên nhãn pixel-exact chỉ dành cho PNG đã kiểm tra.

## 8. Các ca bắt buộc

Mask rỗng; mask toàn ảnh; protect toàn bộ; vùng 1 pixel; nhiều vùng/lỗ; cạnh ảnh; feather radius lớn; candidate size sai; portrait có EXIF rotate; alpha 0/128/255; ảnh profile khác; canvas zoom/pan/DPR; crop có padding; candidate reframe; PNG decoder round-trip; xuất JPEG; resize sau edit; revision baseline thay đổi trong lúc job đang chạy.

Job đang chạy luôn gắn bản mask và baseline ban đầu. Người dùng vẽ mask mới trong lúc chờ tạo draft/revision khác; candidate của job cũ không được tự ghép vào mask mới.
