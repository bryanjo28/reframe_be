function layout({ title, intro, content, actionLabel, actionUrl }) {
  const action = actionLabel
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 20px"><tr><td bgcolor="#635bff" style="border-radius:10px"><a href="${actionUrl}" style="display:inline-block;padding:14px 22px;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none">${actionLabel}</a></td></tr></table>`
    : "";
  const fallbackLink = actionUrl
    ? `<p style="margin:22px 0 0;color:#667085;font-size:13px;line-height:1.7">Jika tombol tidak bisa dibuka, salin dan tempel tautan ini ke browser:<br><a href="${actionUrl}" style="color:#5145cd;word-break:break-all">${actionUrl}</a></p>`
    : "";
  return `<!doctype html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f6fb;color:#182230;font-family:Arial,Helvetica,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${intro}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f4f6fb">
    <tr><td align="center" style="padding:36px 16px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px">
        <tr><td style="padding:0 0 18px 4px;color:#182230;font-size:22px;font-weight:bold;letter-spacing:-.5px">alurin<span style="color:#635bff">.</span></td></tr>
        <tr><td bgcolor="#ffffff" style="padding:36px 34px;border:1px solid #e7eaf1;border-radius:16px">
          <p style="margin:0 0 10px;color:#635bff;font-size:12px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase">ALURIN ACCOUNT</p>
          <h1 style="margin:0 0 16px;color:#182230;font-size:25px;line-height:1.3">${title}</h1>
          <p style="margin:0;color:#475467;font-size:15px;line-height:1.75">${intro}</p>
          ${content || ""}
          ${action}
          ${fallbackLink}
        </td></tr>
        <tr><td style="padding:20px 8px;color:#667085;font-size:12px;line-height:1.7">Email otomatis dari Alurin. Demi keamanan, jangan bagikan tautan atau kode verifikasi ini kepada siapa pun.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function actionEmail(title, intro, actionLabel) {
  return layout({ title, intro, actionLabel, actionUrl: "{{ .ConfirmationURL }}" });
}

function noticeEmail(title, intro, content) {
  return layout({ title, intro, content });
}

const authEmailTemplates = {
  "confirm-sign-up": {
    subject: "Konfirmasi email Alurin",
    body: actionEmail("Satu langkah lagi untuk mulai", "Terima kasih sudah mendaftar di Alurin. Konfirmasi alamat email kamu untuk mengaktifkan akun dan mulai merencanakan konten.", "Konfirmasi email"),
  },
  "invite-user": {
    subject: "Kamu diundang ke Alurin",
    body: actionEmail("Undangan untuk bergabung", "Kamu mendapat undangan untuk membuat akun dan mulai menggunakan Alurin. Buka tautan ini untuk menerima undangan.", "Terima undangan"),
  },
  "magic-link-or-otp": {
    subject: "Link masuk Alurin",
    body: actionEmail("Masuk ke akun Alurin", "Gunakan tombol berikut untuk masuk. Tautan ini hanya berlaku satu kali dan sebaiknya tidak diteruskan.", "Masuk ke Alurin"),
  },
  "change-email-address": {
    subject: "Konfirmasi perubahan email Alurin",
    body: actionEmail("Konfirmasi alamat email baru", "Kami menerima permintaan untuk mengganti email akun Alurin menjadi {{ .NewEmail }}. Konfirmasi perubahan ini jika memang kamu yang memintanya.", "Konfirmasi email baru"),
  },
  "reset-password": {
    subject: "Atur ulang kata sandi Alurin",
    body: actionEmail("Buat kata sandi baru", "Kami menerima permintaan untuk mengatur ulang kata sandi akun Alurin. Gunakan tombol ini untuk melanjutkan. Jika kamu tidak meminta perubahan, abaikan email ini.", "Atur ulang kata sandi"),
  },
  reauthentication: {
    subject: "Kode verifikasi Alurin: {{ .Token }}",
    body: noticeEmail("Verifikasi tindakan kamu", "Masukkan kode satu kali ini untuk melanjutkan tindakan sensitif di Alurin.", `<p style="margin:24px 0;padding:18px;background:#f4f3ff;border:1px solid #e4e1ff;border-radius:10px;color:#342b91;font-size:28px;font-weight:bold;letter-spacing:8px;text-align:center">{{ .Token }}</p><p style="margin:0;color:#667085;font-size:13px;line-height:1.7">Jangan bagikan kode ini. Jika kamu tidak sedang melakukan tindakan ini, abaikan email dan amankan akunmu.</p>`),
  },
  "password-changed": {
    subject: "Kata sandi Alurin berhasil diubah",
    body: noticeEmail("Kata sandi berhasil diubah", "Kata sandi akun Alurin kamu baru saja diubah.", `<p style="margin:20px 0 0;color:#475467;font-size:14px;line-height:1.7">Jika perubahan ini bukan dari kamu, segera atur ulang kata sandi dan hubungi tim Alurin.</p>`),
  },
  "email-address-changed": {
    subject: "Alamat email Alurin berhasil diubah",
    body: noticeEmail("Alamat email berhasil diubah", "Perubahan alamat email akun Alurin telah selesai.", `<p style="margin:20px 0 0;color:#475467;font-size:14px;line-height:1.8">Email sebelumnya: <strong>{{ .OldEmail }}</strong><br>Email sekarang: <strong>{{ .Email }}</strong></p><p style="margin:16px 0 0;color:#667085;font-size:13px;line-height:1.7">Jika kamu tidak melakukan perubahan ini, segera amankan akun Alurin.</p>`),
  },
  "phone-number-changed": {
    subject: "Nomor telepon Alurin berhasil diubah",
    body: noticeEmail("Nomor telepon berhasil diubah", "Nomor telepon akun Alurin kamu telah diperbarui.", `<p style="margin:20px 0 0;color:#475467;font-size:14px;line-height:1.8">Nomor sebelumnya: <strong>{{ .OldPhone }}</strong><br>Nomor sekarang: <strong>{{ .Phone }}</strong></p><p style="margin:16px 0 0;color:#667085;font-size:13px;line-height:1.7">Jika kamu tidak melakukan perubahan ini, segera amankan akun Alurin.</p>`),
  },
  "sign-in-method-linked": {
    subject: "Metode masuk baru terhubung ke Alurin",
    body: noticeEmail("Metode masuk baru terhubung", "Metode masuk {{ .Provider }} telah ditautkan ke akun Alurin {{ .Email }}.", `<p style="margin:20px 0 0;color:#667085;font-size:13px;line-height:1.7">Jika kamu tidak melakukan ini, segera amankan akunmu.</p>`),
  },
  "sign-in-method-removed": {
    subject: "Metode masuk dihapus dari Alurin",
    body: noticeEmail("Metode masuk telah dihapus", "Metode masuk {{ .Provider }} telah dilepas dari akun Alurin {{ .Email }}.", `<p style="margin:20px 0 0;color:#667085;font-size:13px;line-height:1.7">Jika kamu tidak melakukan ini, segera amankan akunmu.</p>`),
  },
  "mfa-method-added": {
    subject: "Metode verifikasi baru ditambahkan ke Alurin",
    body: noticeEmail("Verifikasi tambahan diaktifkan", "Metode verifikasi {{ .FactorType }} telah ditambahkan ke akun Alurin kamu.", `<p style="margin:20px 0 0;color:#667085;font-size:13px;line-height:1.7">Jika kamu tidak melakukan ini, segera amankan akunmu.</p>`),
  },
  "mfa-method-removed": {
    subject: "Metode verifikasi dihapus dari Alurin",
    body: noticeEmail("Metode verifikasi dihapus", "Metode verifikasi {{ .FactorType }} telah dihapus dari akun Alurin kamu.", `<p style="margin:20px 0 0;color:#667085;font-size:13px;line-height:1.7">Jika kamu tidak melakukan ini, segera amankan akunmu.</p>`),
  },
};

module.exports = { authEmailTemplates };
