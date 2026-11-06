import { Body, Controller, Post } from '@nestjs/common';
import { PRODUCTS } from '../shared/catalog.js';
import { checkEnquiry, type EnquiryRequest } from '../shared/rules.js';
import { Database } from './database.js';
import { invalid } from './errors.js';
import { Mailer } from './mail.js';

const SALES = 'sales@example.com';

function interests(enquiry: EnquiryRequest): string {
  if (enquiry.source === 'licensing') return 'Model Weights Licensing';
  return PRODUCTS.filter((product) => enquiry.products!.includes(product.id))
    .map((product) => product.label)
    .join(', ');
}

@Controller('enquiries')
export class EnquiriesController {
  constructor(
    private readonly db: Database,
    private readonly mailer: Mailer,
  ) {}

  /** Stores the enquiry, then tells sales and acknowledges the sender; a failed send keeps the stored row. */
  @Post()
  async create(@Body() body: Record<string, unknown>) {
    const checked = checkEnquiry(body ?? {});
    if (!checked.ok) throw invalid(checked.errors);
    const enquiry = checked.value;
    const { rows } = await this.db.query(
      `INSERT INTO enquiries (source, first_name, last_name, full_name, email, company, company_size, industry, products, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, source, first_name, last_name, full_name, email, company, company_size, industry, products, message, created_at`,
      [enquiry.source, enquiry.first_name, enquiry.last_name, enquiry.full_name, enquiry.email, enquiry.company,
        enquiry.company_size, enquiry.industry, enquiry.products && JSON.stringify(enquiry.products), enquiry.message],
    );
    const person = enquiry.full_name ?? `${enquiry.first_name} ${enquiry.last_name}`;
    await this.mailer.send({
      to: SALES,
      subject: `New enterprise enquiry from ${enquiry.company}`,
      text: [
        `A new ${enquiry.source === 'licensing' ? 'model licensing' : 'enterprise'} enquiry arrived.`,
        '',
        `Name: ${person}`,
        `Business email: ${enquiry.email}`,
        `Company: ${enquiry.company}`,
        `Company size: ${enquiry.company_size}`,
        `Industry: ${enquiry.industry}`,
        `Products of interest: ${interests(enquiry)}`,
        '',
        'Message:',
        enquiry.message,
        '',
      ].join('\n'),
    });
    await this.mailer.send({
      to: enquiry.email,
      subject: 'We received your enquiry',
      text:
        `Hello ${enquiry.first_name ?? enquiry.full_name},\n\n` +
        `Thank you for telling us about ${enquiry.company}. Our team will be in touch within two business days.\n\n` +
        `Kinora\n`,
    });
    return rows[0];
  }
}
