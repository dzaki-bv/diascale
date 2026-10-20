# Signing dan pemasangan iOS dengan akun Apple gratis

Panduan ini untuk kondisi saat ini: akun Apple gratis, prototype DiaScale untuk dicoba di iPhone teman. Build `.app`/ZIP unsigned yang dihasilkan sebelumnya belum bisa dipasang begitu saja dari WhatsApp atau Files.

## Jalur gratis: Personal Team melalui Xcode

1. Siapkan Mac dengan Xcode dan iPhone teman yang akan dipakai. Jalankan `npm run ios:sync` dari direktori proyek agar UI terbaru masuk ke bundel iOS.
2. Buka `ios/DiaScale.xcodeproj` di Xcode.
3. Di **Xcode → Settings → Apple Accounts**, masuk dengan Apple Account untuk pengembangan. Jika memakai akun teman, biarkan teman melakukan login dan autentikasinya sendiri.
4. Pada target **DiaScale → Signing & Capabilities**, aktifkan **Automatically manage signing**, lalu pilih **Personal Team** yang sesuai.
5. Jika bundle identifier `com.diascale.app` tidak tersedia, ganti menjadi identifier unik yang kamu miliki, misalnya `id.namamu.diascale.preview`. Perubahan ini hanya identitas aplikasi, bukan tampilan.
6. Hubungkan iPhone melalui USB, buka kunci, dan setujui **Trust This Computer** di iPhone jika diminta. Pilih perangkat itu sebagai run destination di Xcode.
7. Jika Xcode meminta **Developer Mode**, aktifkan di **Settings → Privacy & Security → Developer Mode**, kemudian ikuti restart dan konfirmasi di iPhone. Login/persetujuan ini dilakukan pemilik perangkat.
8. Tekan **Run** di Xcode. Xcode akan mengatur development signing/provisioning dan memasang aplikasi ke perangkat itu. Jika ada pesan developer belum dipercaya, ikuti instruksi ke **Settings → General → VPN & Device Management** dan percaya profil developer yang digunakan.

Provisioning Personal Team berlaku **7 hari**. Setelah kedaluwarsa, rebuild dan instal ulang melalui Xcode. Apple juga membatasi jumlah App ID, perangkat, dan aplikasi pada Personal Team. Ini cocok untuk uji coba langsung, bukan distribusi bebas ke sembarang iPhone.

Rujukan Apple: [Personal Team dan masa berlaku provisioning](https://developer.apple.com/help/account/basics/about-your-developer-account), [menjalankan app di perangkat fisik dan automatic signing](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices).

## Jika teman jauh atau ingin undangan instalasi

Jalur resmi yang lebih mudah untuk tester jarak jauh adalah **TestFlight**, melalui Apple Developer Program. Biayanya **USD 99 per tahun** atau harga lokal yang berlaku. Setelah menyiapkan signing dan record aplikasi di App Store Connect, upload archive lalu undang tester eksternal. Build untuk tester eksternal mungkin memerlukan Beta App Review. Teman menginstal TestFlight dan menerima undangan, tanpa harus menghubungkan iPhone ke Mac kamu.

Akun gratis saat ini belum menyediakan jalur TestFlight. Mengirim ZIP unsigned atau sekadar mengubah namanya menjadi `.ipa` tidak membuatnya bisa dipasang.

Rujukan Apple: [keanggotaan dan TestFlight](https://developer.apple.com/programs/), [biaya keanggotaan](https://developer.apple.com/help/account/membership/program-enrollment), [tester eksternal](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/).

Tidak ada akun Apple, sertifikat, provisioning profile, atau perangkat teman yang didaftarkan oleh perubahan kode ini. Pemilihan akun/team dan penyambungan iPhone masih perlu dilakukan sebelum signing fisik.
