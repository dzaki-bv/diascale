# DiaScale iOS

Proyek Capacitor 8 dengan plugin Bluetooth LE, Preferences, dan App. Identitas default `com.diascale.app`, target/scheme `App`, produk `DiaScale.app`, minimum iOS 16. Aset frontend dan font disertakan dalam aplikasi; perhitungan dan penyimpanan berjalan offline.

## Build

Dari root proyek:

```sh
npm install
npm run ios:sync
npm run ios:build
npm run ios:build:device
```

`ios:sync` membangun Vite dan menjalankan `cap sync ios` dari workspace `app`. `ios:build` menghasilkan aplikasi simulator dengan ad-hoc signing. `ios:build:device` menghasilkan build iPhone unsigned. Output berada di `ios/build/Build/Products/Debug-iphonesimulator/DiaScale.app` dan `Debug-iphoneos/DiaScale.app`.

Xcode menggunakan Swift Package Manager untuk Capacitor dan plugin. Build awal memerlukan jaringan untuk mengambil dependensi. SDK dan komponen platform/runtime simulator yang cocok harus terpasang di Xcode → Settings → Components. Jika Xcode melaporkan “iOS Platform Not Installed” meski SDK muncul di `xcodebuild -showsdks`, selesaikan instalasi komponen tersebut. Bluetooth tidak tersedia di simulator; jangan memakai simulator sebagai bukti penerimaan timbangan.

## Signing dan pemasangan

Buka `ios/App/App.xcodeproj`, pilih scheme `App`, dan pilih perangkat yang sesuai. `ios/debug.xcconfig` memuat `ios/Signing.xcconfig`, yang memuat override opsional `Signing.local.xcconfig` (diabaikan Git). Team dan identifier lokal dari wrapper lama dipertahankan; ikon dipindahkan ke asset catalog Capacitor.

```sh
npm run ios:check
npm run ios:install
```

Jika ada beberapa perangkat, pilih `--device IDENTIFIER`. Installer memilih destination yang sama saat build, memverifikasi signature dan provisioning perangkat, lalu memasang aplikasi. Lihat [panduan signing](../docs/ios-signing.md). Saat ini tidak ada iPhone tersambung untuk pengujian fisik.

## Implementasi

Capacitor menyediakan bridge native dan memuat aset lokal melalui origin `capacitor://localhost`. `NSBluetoothAlwaysUsageDescription` menjelaskan akses Bluetooth. `PrivacyInfo.xcprivacy` menyatakan penggunaan UserDefaults oleh Preferences. Pengukuran dibatalkan saat aplikasi masuk latar belakang; antrean pengiriman dicoba kembali saat aktif.

Tidak ada lagi wrapper SwiftUI/WKWebView atau HTML inline buatan sendiri. Tes DOM membundel ulang graph Vite produksi untuk jsdom dan meniru bridge Capacitor, bukan menggantikan Safari atau pengujian native. Pengukuran langsung dan deployment ditunda sesuai instruksi pengguna.

## Verifikasi lokal 1 November 2026

Build unsigned iPhone dan build simulator dengan ad-hoc signing berhasil. Paket arm64-only iOS 26.5 ditolak CoreSimulator; paket universal 23F77 berhasil dipasang. Pemeriksaan peluncuran simulator dihentikan selama migrasi awal karena penggunaan memori/swap dan ruang disk; peluncuran native belum terverifikasi. Simulator uji baru sudah dimatikan dan dikosongkan. Tidak ada pemasangan ke iPhone fisik atau pengukuran langsung.
