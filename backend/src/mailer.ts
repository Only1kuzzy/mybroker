import nodemailer from 'nodemailer';

export interface WithdrawalEmailOptions {
  to: string;
  fullName?: string;
  amount: number | string;
  walletAddress: string;
  status?: string;
  subject?: string;
  delayReason?: string;
  customMessage?: string;
  txHash?: string;
}

function getTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 465;
  const secure = process.env.SMTP_SECURE === 'false' ? false : port === 465;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, '');

  if (!user || !pass) {
    console.warn('[Mailer] SMTP_USER or SMTP_PASS is missing in environment variables. Email will not be sent.');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });
}

export async function sendWithdrawalEmail(options: WithdrawalEmailOptions): Promise<{ success: boolean; error?: string }> {
  const {
    to,
    fullName = 'Valued Investor',
    amount,
    walletAddress,
    status = 'approved',
    subject,
    delayReason,
    customMessage,
    txHash,
  } = options;

  const transporter = getTransporter();
  if (!transporter) {
    return { success: false, error: 'SMTP credentials not configured in backend environment' };
  }

  const fromAddress = process.env.SMTP_FROM || `Crypto Vault <${process.env.SMTP_USER}>`;
  const defaultSubject = status === 'approved'
    ? 'Withdrawal Processed & Dispatched'
    : 'Withdrawal Request Update';
  const mailSubject = subject && subject.trim() ? subject.trim() : defaultSubject;

  const formattedAmount = Number(amount).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });

  const currentDate = new Date().toUTCString();

  // Reason / Delay Note box HTML
  const reasonHtml = delayReason && delayReason.trim() ? `
    <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 14px 18px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0 0 6px 0; font-weight: 700; color: #b45309; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">
        ⚠️ Delivery & Settlement Status Note:
      </p>
      <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.5;">
        ${escapeHtml(delayReason.trim())}
      </p>
    </div>
  ` : '';

  // Custom message HTML
  const customMessageHtml = customMessage && customMessage.trim() ? `
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 14px 18px; margin: 18px 0; border-radius: 6px;">
      <p style="margin: 0; color: #334155; font-size: 14px; line-height: 1.6;">
        ${escapeHtml(customMessage.trim())}
      </p>
    </div>
  ` : '';

  // Tx Hash HTML
  const txHashHtml = txHash && txHash.trim() ? `
    <tr>
      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Transaction Ref / Hash:</td>
      <td style="padding: 10px 0; font-weight: 600; color: #0f172a; font-size: 13px; font-family: monospace; text-align: right; word-break: break-all;">
        ${escapeHtml(txHash.trim())}
      </td>
    </tr>
  ` : '';

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(mailSubject)}</title>
</head>
<body style="margin: 0; padding: 30px 15px; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.2);" cellspacing="0" cellpadding="0" border="0">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 32px 30px; text-align: center; border-bottom: 3px solid #3b82f6;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">CRYPTO VAULT</h1>
              <p style="margin: 6px 0 0 0; color: #94a3b8; font-size: 14px;">Secure Asset Management & Payouts</p>
            </td>
          </tr>

          <!-- Main Body -->
          <tr>
            <td style="padding: 32px 30px;">
              <h2 style="margin: 0 0 12px 0; color: #0f172a; font-size: 20px; font-weight: 600;">
                Withdrawal Update
              </h2>
              <p style="margin: 0 0 16px 0; color: #475569; font-size: 15px; line-height: 1.5;">
                Hello <strong>${escapeHtml(fullName)}</strong>,
              </p>
              <p style="margin: 0 0 20px 0; color: #475569; font-size: 15px; line-height: 1.5;">
                Your withdrawal request of <strong style="color: #0f172a; font-size: 16px;">${formattedAmount}</strong> has been processed by our security team.
              </p>

              ${reasonHtml}
              ${customMessageHtml}

              <!-- Transaction Summary Card -->
              <table role="presentation" width="100%" style="margin: 24px 0; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px;" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-size: 14px; border-bottom: 1px solid #edf2f7;">Payout Amount:</td>
                  <td style="padding: 8px 0; font-weight: 700; color: #10b981; font-size: 16px; text-align: right; border-bottom: 1px solid #edf2f7;">
                    ${formattedAmount}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-size: 14px; border-bottom: 1px solid #edf2f7;">Destination Address:</td>
                  <td style="padding: 8px 0; font-weight: 600; color: #0f172a; font-size: 13px; font-family: monospace; text-align: right; border-bottom: 1px solid #edf2f7; word-break: break-all;">
                    ${escapeHtml(walletAddress)}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-size: 14px; ${txHashHtml ? 'border-bottom: 1px solid #edf2f7;' : ''}">Timestamp:</td>
                  <td style="padding: 8px 0; color: #334155; font-size: 13px; text-align: right; ${txHashHtml ? 'border-bottom: 1px solid #edf2f7;' : ''}">
                    ${currentDate}
                  </td>
                </tr>
                ${txHashHtml}
              </table>

              <p style="margin: 24px 0 0 0; color: #64748b; font-size: 13px; line-height: 1.5;">
                If you have questions regarding this transaction or notice discrepancies with your destination address, please reach out to our support department.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f1f5f9; padding: 20px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                This is an automated system notification from Crypto Vault Portfolio Management.
              </p>
              <p style="margin: 6px 0 0 0; color: #94a3b8; font-size: 12px;">
                &copy; ${new Date().getFullYear()} Crypto Vault. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const textContent = `
Crypto Vault - Withdrawal Update

Hello ${fullName},

Your withdrawal request of ${formattedAmount} has been processed.

${delayReason ? `Delivery Status & Reason:\n${delayReason}\n\n` : ''}
${customMessage ? `Note from Support:\n${customMessage}\n\n` : ''}

Transaction Details:
- Amount: ${formattedAmount}
- Destination: ${walletAddress}
- Date: ${currentDate}
${txHash ? `- Reference: ${txHash}\n` : ''}

Thank you,
Crypto Vault Management Team
  `.trim();

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject: mailSubject,
      text: textContent,
      html: htmlContent,
    });
    console.log(`[Mailer] Withdrawal email sent to ${to}: ${info.messageId}`);
    return { success: true };
  } catch (err: any) {
    console.error(`[Mailer] Error sending email to ${to}:`, err);
    return { success: false, error: err?.message || 'Failed to send email' };
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
