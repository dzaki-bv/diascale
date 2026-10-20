# DiaScale

Frontend mobile untuk mengenali dan memantau risiko diabetes tipe 2. Desain terakhir mengutamakan skor dan kategori risiko, dengan data tubuh sebagai pendukung.

## Web

```sh
npm install
npm run dev
```

Buka http://localhost:4173. Pemilih halaman berada di luar bingkai HP. `?demo=1` membuka akun contoh; `?demo=1&screen=result` membuka rincian risiko. Salinan prototype sebelumnya ada di `/prototype/`.

Untuk paket web statis:

```sh
npm run build
npm run preview
```

## Android

Membutuhkan Java 21+, Android SDK platform 36, serta SDK build tools. Isi `android/local.properties` dengan `sdk.dir=/path/ke/android-sdk`, atau atur `ANDROID_HOME`. Kemudian:

```sh
npm run android:build
adb -s SERIAL install --user 0 -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s SERIAL shell am start --user 0 -n com.diascale.app/.MainActivity
```

APK berisi aset dan font lokal. Android memuat konten melalui WebViewAssetLoader HTTPS tanpa izin jaringan, bridge JavaScript/native, atau akses berkas. Aplikasi memakai layar HP sepenuhnya, bukan bingkai desktop.

## Batas implementasi

Belum ada backend, pengiriman OTP sungguhan, Bluetooth, atau metode penilaian risiko klinis. Gunakan kode enam digit untuk melanjutkan alur OTP. Data hasil adalah contoh, bukan penilaian medis; data akun dan riwayat hanya berada di memori dan hilang saat aplikasi dimuat ulang atau proses dihentikan. Perubahan profil tidak mengubah snapshot hasil lama. Tidak ada penyimpanan atau pengiriman data kesehatan ke server.

Sesuai permintaan pengguna, tidak ditambahkan atau dijalankan tes maupun pemeriksaan UI browser. Build web dan kompilasi Android dijalankan untuk menghasilkan APK yang dipasang.

## Susunan kode

- `src/app.js`: navigasi dan pengendali interaksi.
- `src/model.js`: state sesi dan fixture data.
- `src/screens/`: halaman akun, beranda, pengukuran, risiko, riwayat, dan profil.
- `src/ui/`: elemen antarmuka, ikon, serta pemformatan.
- `android/`: shell Android dan konfigurasi build.
- `docs/implementation-spec.md`: keputusan produk dan batas implementasi.

## iOS

```sh
npm run ios:build
npm run ios:build:device
```

Project Xcode: `ios/DiaScale.xcodeproj`. Build simulator dan iPhone ada di `ios/build/Build/Products/`. Build iPhone belum ditandatangani; pemasangan fisik memerlukan Apple development team dan provisioning yang sesuai di Xcode. Lihat `ios/README.md` untuk langkah lengkap. Versi iOS membundel UI dan font yang sama secara offline, tanpa server.
