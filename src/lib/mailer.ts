import nodemailer from "nodemailer";
import { decrypt } from "@/lib/crypto";
import type { EmailAccount } from "@/lib/db";

// Appen støtter i dag bare Google Workspace/Gmail for e-postkontoen (se
// standardverdien for imapHost i innstillinger) — samme app-passord fungerer
// for både IMAP og SMTP, så vi trenger ingen egne SMTP-felt på kontoen.
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;

export async function sendMailFromAccount(
  account: EmailAccount,
  opts: {
    fromName: string;
    to: string[];
    subject: string;
    text: string;
    attachment: { filename: string; content: Buffer };
  }
) {
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true,
    auth: {
      user: account.imapUser,
      pass: decrypt(account.passwordEnc),
    },
  });

  await transporter.sendMail({
    from: `"${opts.fromName}" <${account.email}>`,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    attachments: [opts.attachment],
  });
}
