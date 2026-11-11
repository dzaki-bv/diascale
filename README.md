# DiaScale

Aplikasi Android/iOS untuk membaca timbangan LUCA VOSS FG2504WB, menghitung komposisi tubuh dan skor risiko diabetes tipe 2, lalu menyimpan hasil di perangkat. Server Cloudflare Worker + D1 tersedia sebagai arsip opsional. DiaScale adalah prototype nonkomersial; kesesuaian hasil pada perangkat fisik masih perlu diuji.

## Web dan pengembangan

```sh
npm install
npm run dev
```

Buka http://localhost:4173. Aplikasi utama tidak berisi hasil contoh atau OTP. Salinan desain lama tetap tersedia melalui `npm run prototype`. Bluetooth utama ditujukan untuk Android/iOS melalui Capacitor; browser tanpa dukungan pemindaian Web Bluetooth akan menampilkan kegagalan koneksi dan tidak membuat hasil palsu.

```sh
npm run build
npm run preview
npm test
npm run check -w app
npm run check -w server
```

Tes menggunakan paket timbangan yang direkam sebelumnya dan bridge native tiruan. Tidak membutuhkan timbangan, HP, atau deployment. Cakupan dan keterbatasan ada di [docs/testing.md](docs/testing.md).

## Android

Membutuhkan Java 21 dan Android SDK platform 36. Isi `android/local.properties` dengan `sdk.dir=/path/ke/android-sdk`, atau atur `ANDROID_HOME`.

```sh
npm run android:build
adb -s SERIAL install --user 0 -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s SERIAL shell am start --user 0 -n com.diascale.app/.MainActivity
```

Jika Java belum terpilih pada Mac ini, awali perintah build dengan `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`. `native:sync` membangun frontend dan menyalin aset serta konfigurasi plugin ke kedua proyek Capacitor. Android memakai izin Bluetooth perangkat sekitar dan jaringan; Android 11 ke bawah juga memerlukan izin lokasi untuk pemindaian BLE.

## iOS

```sh
npm run ios:build
npm run ios:build:device
```

Project Xcode: `ios/App/App.xcodeproj`, scheme/target `App`, produk `DiaScale.app`. Konfigurasi signing lokal dan ikon sebelumnya dipertahankan. SDK dan komponen platform iOS yang sesuai harus tersedia di Xcode; build perangkat fisik memerlukan signing Apple. Lihat [ios/README.md](ios/README.md) dan [panduan signing](docs/ios-signing.md).

## Data dan sinkronisasi

- Pendaftaran memakai nomor HP biasa, jenis kelamin wajib, usia minimal 18 tahun, tinggi badan dalam cm bulat, dan jawaban kesehatan Ya/Tidak. Nomor HP memilih profil lokal; tidak ada verifikasi SMS atau login lintas perangkat.
- Hasil berasal dari A7 yang cocok dengan ID instalasi dan sepuluh impedansi valid. Aplikasi menampilkan BMI, massa lemak, lemak viseral, massa otot, lingkar pinggang, serta skor Aman/Meningkat/Waspada.
- Capacitor Preferences menyimpan profil lokal, snapshot hasil, identitas instalasi, dan antrean pengiriman. Hasil dan antreannya ditulis bersama sebelum halaman menyatakan hasil tersimpan. Perubahan profil tidak menghitung ulang riwayat. Saat versi aturan skor berubah, hasil lama di perangkat dihitung ulang sekali ketika aplikasi dibuka, memakai angka tersimpan dan jawaban profil saat pengukuran (`rescore` di core); arsip server tidak ikut berubah otomatis.
- Secara default, hasil hanya disimpan di perangkat. Untuk menyiapkan sinkronisasi, salin `app/.env.example` ke `app/.env.local`, isi `VITE_ARCHIVE_URL` dengan origin HTTPS Worker, lalu build ulang. Untuk tes browser/server lokal, gunakan `http://127.0.0.1:8787` dan jalankan Worker sesuai [panduan server](server/README.md).
- Saat URL tersedia, aplikasi membuat akun acak per instalasi dan menyimpan token sebelum mengirim hasil. Pengiriman berjalan saat online, aplikasi aktif kembali, atau ada hasil baru, dengan retry bertahap. Respons duplikat membersihkan antrean; kegagalan permanen tetap disimpan agar tidak menghilangkan data.
- Server hanya arsip. Aplikasi tidak mengunduh riwayat; menghapus data aplikasi atau kehilangan HP menghilangkan riwayat lokal.

## Susunan kode

- `app/src/app.js`, `screens/`, `ui/`: navigasi dan antarmuka.
- `app/src/model.js`: pemetaan profil dan tampilan hasil core; tanpa fixture contoh.
- `app/src/scale.ts`: pemindaian, verifikasi model, koneksi BLE, pembatalan, dan sesi pengukuran.
- `app/src/storage.ts`, `sync.ts`: penyimpanan atomik lokal dan antrean pengiriman.
- `packages/core/`: protokol, perhitungan tubuh, skor dan payload hasil TypeScript.
- `server/`: Worker + D1, migrasi, validasi dan tes runtime Workers.
- `android/`, `ios/`: proyek Capacitor; wrapper WebView dan script sinkronisasi lama sudah diganti.
- `research/scale/`: alat, rekaman dan catatan protokol timbangan.
- `docs/scale-integration-spec.md`, `docs/scale-integration-plan.md`: spesifikasi dan status fase.

Deployment serta pengujian dengan timbangan langsung belum dilakukan, sesuai batas pekerjaan yang diminta.
