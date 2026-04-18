# TikTok Re-Follow Helper

Chrome Extension (Manifest V3) giúp follow lại toàn bộ danh sách tài khoản đã
follow từ file `user_data_tiktok.json` mà TikTok xuất trong Data Export.

> Extension này hoạt động trực tiếp trên tab trình duyệt sau khi bạn đã đăng
> nhập TikTok. Nó chỉ tự động hóa thao tác click nút **Follow** mà bình thường
> bạn vẫn bấm tay.

## Tính năng

- Nạp trực tiếp file JSON TikTok xuất (`Activity.Following.Following`).
- Sắp xếp theo mới nhất, cũ nhất hoặc ngẫu nhiên.
- Tự chỉnh delay min / max (giây) giữa các lần follow.
- Daily cap để giới hạn số follow/ngày, tự reset khi sang ngày mới.
- Auto pause khi gặp captcha hoặc có >= 3 lỗi liên tiếp.
- Progress bar, log realtime, export report JSON khi cần.
- Resume sau khi giải captcha hoặc mở lại Chrome.

## Cài đặt (Developer Mode)

1. Mở Chrome và vào `chrome://extensions`.
2. Bật toggle **Developer mode** ở góc phải trên.
3. Bấm **Load unpacked** và chọn thư mục `tiktok-auto-follow` (thư mục chứa
   `manifest.json`).
4. Ghim icon extension lên thanh toolbar cho tiện.

## Cách dùng

1. Đăng nhập TikTok trên https://www.tiktok.com bằng nick muốn dùng để follow
   lại (nick này phải đang mở phiên trong Chrome).
2. Click icon extension. Trong popup:
   - Chọn file `user_data_tiktok.json` → popup báo số username đã nạp.
   - Chỉnh **Delay min / max** và **Daily cap** tùy gu.
   - Chọn **Thứ tự** (mặc định: mới nhất trước).
   - Bấm **Start**.
3. Extension mở một tab TikTok nền (không active), lần lượt điều hướng tới
   từng profile và click Follow với delay ngẫu nhiên trong khoảng bạn cài.
4. Bạn có thể đóng popup, máy vẫn chạy nền. Mở lại popup bất cứ lúc nào để
   xem tiến độ + log.

## Các trạng thái trong log

| Status       | Ý nghĩa |
|--------------|---------|
| `followed`   | Đã click Follow thành công. |
| `already`    | Đã follow sẵn từ trước (bỏ qua). |
| `not_found`  | Tài khoản không tồn tại / bị xóa. |
| `captcha`    | Gặp captcha → extension auto pause. |
| `error`      | Không tìm thấy nút Follow hoặc click không đổi trạng thái. |
| `timeout`    | Trang không tải xong trong 25 giây. |
| `info`       | Thông báo chung (bắt đầu, tạm dừng, reset...). |

## Khi gặp captcha

1. Extension sẽ tự đổi trạng thái sang `captcha` và dừng.
2. Mở tab TikTok đang hiển thị captcha, giải tay như bình thường.
3. Bấm **Resume** trong popup để tiếp tục từ user kế tiếp.

## Khi đạt daily cap

- Extension tự pause. Sáng hôm sau mở popup và bấm **Resume** (hoặc
  **Start**), counter `followedToday` sẽ tự reset theo ngày mới.

## Gợi ý pacing an toàn

- Nick mới: `delayMin=30`, `delayMax=70`, `dailyCap=100-150`.
- Nick lâu năm, điểm trust cao: `delayMin=15`, `delayMax=35`, `dailyCap=250-300`.
- Nếu dính `error` / `captcha` nhiều → tăng delay, giảm cap rồi thử lại hôm sau.

## Export report

Bấm **Export report** để tải file JSON gồm toàn bộ username + trạng thái xử
lý (`followed`, `already`, `not_found`, `error`, `timeout`, `pending`). Dùng
để đối chiếu hoặc retry phần bị miss.

## Reset

Bấm **Reset** để xóa queue + log + counter và nạp lại từ đầu. Thao tác này
không đụng tới các user đã follow thực tế trên TikTok.

## Cấu trúc file

```
tiktok-auto-follow/
├── manifest.json      # MV3 manifest
├── popup.html         # UI popup
├── popup.css
├── popup.js           # Parse JSON, cấu hình, hiển thị tiến độ
├── background.js      # Service worker: queue + scheduler + tab control
├── content.js         # Inject vào profile TikTok, click Follow
├── icons/             # 16 / 48 / 128 px PNG
└── README.md
```

## Lưu ý

- Đừng đóng cửa sổ Chrome chứa tab làm việc. Nếu đóng, extension sẽ tự pause
  và cần Resume khi mở lại.
- TikTok có thể thay đổi DOM bất kỳ lúc nào; nếu selector
  `button[data-e2e="follow-button"]` không còn hoạt động, bạn có thể chỉnh
  trong `content.js` (hàm `findFollowButton`).
- Bạn chịu trách nhiệm với tài khoản của mình khi tự động hóa. Tôn trọng
  giới hạn tốc độ của TikTok (đặt delay + cap hợp lý) để tránh bị hạn chế
  tính năng follow tạm thời.
