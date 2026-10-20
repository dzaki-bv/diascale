# DiaScale iOS

Shell SwiftUI + WKWebView untuk frontend DiaScale yang sama dengan versi web dan Android. Mendukung iOS/iPadOS 16 ke atas. Aset, font, CSS, dan JavaScript disertakan di dalam aplikasi; tidak membutuhkan server atau koneksi jaringan.

## Build

Dari direktori utama proyek:

```sh
npm install
npm run ios:build
npm run ios:build:device
```

Output:

- Simulator: `ios/build/Build/Products/Debug-iphonesimulator/DiaScale.app` (ad-hoc signing lokal, tanpa akun Apple).
- iPhone/iPad: `ios/build/Build/Products/Debug-iphoneos/DiaScale.app` (belum ditandatangani).

Script memakai Xcode di `/Applications/Xcode.app` jika `DEVELOPER_DIR` belum diatur. SDK Xcode diperlukan; build target/SDK tidak memerlukan simulator yang sedang berjalan atau iPhone yang tersambung.

## Memasang ke iPhone

1. Jalankan `npm run ios:sync` untuk membundel frontend terbaru.
2. Buka `ios/DiaScale.xcodeproj` di Xcode.
3. Pilih target DiaScale, lalu Apple development team di Signing & Capabilities.
4. Sambungkan iPhone, pilih sebagai run destination, dan jalankan dari Xcode.

Build perangkat tanpa signing bukan IPA yang siap dipasang. Instalasi fisik memerlukan provisioning/signing Apple yang sesuai; tidak ada sertifikat atau profil provisioning yang disimpan di repo. Untuk simulator, pasang runtime iOS melalui Xcode terlebih dahulu dan gunakan `.app` simulator.

## Catatan implementasi

`npm run ios:sync` menyisipkan JavaScript, CSS, dan font hasil Vite ke satu HTML lokal. JavaScript dijalankan setelah DOM siap tanpa ES module request melalui file URL, sehingga tidak membutuhkan server localhost atau pengecualian keamanan WebKit. WKWebView hanya mengizinkan navigasi utama ke halaman lokal aplikasi dan memakai penyimpanan web nonpersisten. Safe area iOS dipertahankan dan bingkai HP desktop disembunyikan.

UI dan state mengikuti frontend yang disepakati: login/signup OTP contoh, formulir wajib, pengukuran contoh, risiko, riwayat, dan profil. Tidak ada backend, SMS, Bluetooth, atau algoritma klinis sungguhan. Data hanya berada dalam memori. Sesuai permintaan pengguna, tidak dijalankan tes maupun pemeriksaan UI.
