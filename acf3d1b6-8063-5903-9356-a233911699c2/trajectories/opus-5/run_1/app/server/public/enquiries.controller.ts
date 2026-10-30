import { Body, Controller, HttpCode, HttpException, Post } from '@nestjs/common';
import { DbService } from '../db.service';
import { MailService, SALES_INBOX } from '../mail.service';
import { PRODUCTS, validateEnquiry } from '../../shared/forms';

interface EnquiryRow {
  id: string;
  source: 'contact' | 'licensing';
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string;
  company: string;
  company_size: string;
  industry: string;
  products: string[] | null;
  message: string;
  created_at: Date;
}

function productLabels(products: string[] | null, source: string): string {
  if (source === 'licensing') return 'Model Weights Licensing';
  return (products ?? [])
    .map((id) => PRODUCTS.find((product) => product.id === id)?.label ?? id)
    .join(', ');
}

@Controller('api')
export class EnquiriesController {
  constructor(
    private readonly db: DbService,
    private readonly mail: MailService
  ) {}

  @Post('enquiries')
  @HttpCode(201)
  async create(@Body() body: Record<string, unknown>) {
    const errors = validateEnquiry(body);
    if (Object.keys(errors).length) throw new HttpException({ errors }, 422);

    const licensing = body.source === 'licensing';
    const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : null);
    const stored = await this.db.query<EnquiryRow>(
      `insert into enquiries (source, first_name, last_name, full_name, email, company, company_size, industry, products, message)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
      [
        body.source,
        licensing ? null : trim(body.first_name),
        licensing ? null : trim(body.last_name),
        licensing ? trim(body.full_name) : null,
        trim(body.email),
        trim(body.company),
        body.company_size,
        body.industry,
        licensing ? null : (body.products as string[]),
        trim(body.message)
      ]
    );
    const enquiry = stored.rows[0];
    const person = licensing ? enquiry.full_name : `${enquiry.first_name} ${enquiry.last_name}`;

    await this.mail.send({
      to: SALES_INBOX,
      subject: `New enterprise enquiry from ${enquiry.company}`,
      text: [
        `Name: ${person}`,
        `Business email: ${enquiry.email}`,
        `Company: ${enquiry.company}`,
        `Company size: ${enquiry.company_size}`,
        `Industry: ${enquiry.industry}`,
        `Products of interest: ${productLabels(enquiry.products, enquiry.source)}`,
        '',
        'Message:',
        enquiry.message
      ].join('\n')
    });
    await this.mail.send({
      to: enquiry.email,
      subject: 'We received your enquiry',
      text: [
        `Hello ${person},`,
        '',
        'Thanks for writing to Kinora. We received your enquiry and our team will be in touch within two business days.',
        '',
        '- The Kinora team'
      ].join('\n')
    });

    return enquiry;
  }
}
