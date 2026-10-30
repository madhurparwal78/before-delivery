import nodemailer from 'nodemailer';

const FROM = 'studio@example.com';

export function mailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '1025', 10),
    secure: false,
  });
}

/** Send one plain-text email; a failure to deliver is logged and swallowed. */
export async function sendMail({ to, subject, text }) {
  try {
    await mailer().sendMail({ from: FROM, to, subject, text });
  } catch (e) {
    console.log(`[mail] undeliverable to ${to}: ${e.message}`);
  }
}

export function invitationEmail(ownerName, workspaceName, joinUrl) {
  return {
    subject: `${ownerName} invited you to ${workspaceName} on Kinora`,
    text: `Hi!\n\n${ownerName} invited you to ${workspaceName} on Kinora, a shared creative workspace for AI video and images.\n\nFollow this link to join the team:\n\n${joinUrl}\n\nThe link works once. If you were not expecting this invitation, you can ignore this email.\n\nKinora\n`,
  };
}

export function enquirySalesEmail(enquiry) {
  const person = enquiry.source === 'licensing'
    ? enquiry.full_name
    : `${enquiry.first_name} ${enquiry.last_name}`;
  const products = enquiry.products && enquiry.products.length
    ? enquiry.products.join(', ')
    : (enquiry.source === 'licensing' ? 'Model Weights Licensing' : 'none selected');
  return {
    subject: `New enterprise enquiry from ${enquiry.company}`,
    text: `A new enquiry arrived from the Kinora website.\n\nName: ${person}\nBusiness email: ${enquiry.email}\nCompany: ${enquiry.company}\nCompany size: ${enquiry.company_size}\nIndustry: ${enquiry.industry}\nProducts of interest: ${products}\nSource: ${enquiry.source}\n\nMessage:\n${enquiry.message}\n`,
  };
}

export function enquiryAckEmail() {
  return {
    subject: 'We received your enquiry',
    text: `Thanks for getting in touch with Kinora.\n\nWe have your enquiry and our team will be in touch within two business days.\n\nKinora\n`,
  };
}
