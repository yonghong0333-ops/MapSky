// 寄送 Email 用的共用 helper —— Magic Link 登入信會用到。
const nodemailer = require("nodemailer");

let cachedTransporter = null;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_PASS;
  if (!user || !pass) {
    throw new Error("缺少環境變數 GMAIL_USER / GMAIL_PASS（Gmail 帳號與應用程式密碼），無法寄信");
  }
  cachedTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
  return cachedTransporter;
}

/**
 * 信件只放登入按鈕（驗證碼不外露）。
 * 同裝置點按鈕可直接／經 App 完成；不同裝置點進去後，頁面判斷無法跳轉才顯示驗證碼。
 * @param {string} toEmail
 * @param {string} verifyUrl
 * @param {string} [_otpCode] 保留參數相容，不再寫進信件
 */
async function sendMagicLinkEmail(toEmail, verifyUrl, _otpCode) {
  const transporter = getTransporter();

  const html = `
  <div style="font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f4f7fc;border-radius:16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:22px;font-weight:800;color:#2f6fed;">MapSky</div>
    </div>
    <p style="font-size:15px;color:#222b38;line-height:1.7;">您好，這是您在 MapSky 的登入連結，15 分鐘內有效：</p>
    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${verifyUrl}" style="display:inline-block;padding:14px 32px;background:#2f6fed;color:#fff;text-decoration:none;border-radius:999px;font-size:15px;font-weight:700;">登入 MapSky</a>
    </div>
    <p style="font-size:12.5px;color:#6b7684;line-height:1.6;text-align:center;">用<strong>同一支手機</strong>點上面按鈕，系統會嘗試直接完成登入。<br>若在其他裝置開啟，頁面會再顯示驗證碼。</p>
    <p style="font-size:12.5px;color:#6b7684;line-height:1.6;margin-top:20px;">如果按鈕點不了，也可以複製下面這段網址到瀏覽器開啟：<br>
      <span style="word-break:break-all;color:#2f6fed;">${verifyUrl}</span>
    </p>
    <p style="font-size:12px;color:#93a0af;margin-top:24px;">如果不是您本人操作，忽略這封信即可，連結 15 分鐘後會自動失效。</p>
  </div>`;

  await transporter.sendMail({
    from: `"MapSky" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: "登入 MapSky",
    html,
  });
}

module.exports = { sendMagicLinkEmail };
