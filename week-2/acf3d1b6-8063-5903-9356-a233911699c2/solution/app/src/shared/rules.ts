// The field checks of every form, shared by the server (which decides) and the browser (which mirrors them so a
// refused field is marked before anything is sent).

import {
  ASPECTS,
  COMPANY_SIZES,
  DURATIONS,
  IMAGE_COUNT_MAX,
  IMAGE_COUNT_MIN,
  INDUSTRIES,
  PRODUCTS,
  modelOf,
  type Aspect,
  type Model,
} from './catalog.js';

export type FieldErrors = Record<string, string>;
type Checked<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

type Body = Record<string, unknown>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(body: Body, field: string): string {
  const value = body[field];
  return typeof value === 'string' ? value.trim() : '';
}

function within(value: string, min: number, max: number): boolean {
  return value.length >= min && value.length <= max;
}

function finish<T>(errors: FieldErrors, value: T): Checked<T> {
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

const MESSAGES = {
  name: 'Enter a name of 1 to 80 characters.',
  email: 'Enter a valid email address.',
  password: 'Use at least 10 characters.',
  projectName: 'Enter a project name of 1 to 80 characters.',
  prompt: 'Write a prompt first.',
  promptLong: 'Keep the prompt to 1,000 characters or fewer.',
};

function checkEmail(body: Body, errors: FieldErrors, field = 'email'): string {
  const email = text(body, field);
  if (!EMAIL.test(email) || email.length > 254) errors[field] = MESSAGES.email;
  return email;
}

function checkPersonName(body: Body, errors: FieldErrors): string {
  const name = text(body, 'name');
  if (!within(name, 1, 80)) errors.name = MESSAGES.name;
  return name;
}

function checkPassword(body: Body, errors: FieldErrors): string {
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 10) errors.password = MESSAGES.password;
  return password;
}

export function checkSignup(body: Body): Checked<{ name: string; email: string; password: string }> {
  const errors: FieldErrors = {};
  const name = checkPersonName(body, errors);
  const email = checkEmail(body, errors);
  const password = checkPassword(body, errors);
  return finish(errors, { name, email, password });
}

export function checkJoin(body: Body): Checked<{ name: string; password: string }> {
  const errors: FieldErrors = {};
  const name = checkPersonName(body, errors);
  const password = checkPassword(body, errors);
  return finish(errors, { name, password });
}

export function checkInvite(body: Body): Checked<{ email: string }> {
  const errors: FieldErrors = {};
  const email = checkEmail(body, errors);
  return finish(errors, { email });
}

export function checkProjectName(body: Body): Checked<{ name: string }> {
  const errors: FieldErrors = {};
  const name = text(body, 'name');
  if (!within(name, 1, 80)) errors.name = MESSAGES.projectName;
  return finish(errors, { name });
}

export interface GenerationRequest {
  project_id: string;
  model: Model;
  prompt: string;
  duration: number | null;
  image_count: number | null;
  aspect: Aspect;
}

export function checkGeneration(body: Body): Checked<GenerationRequest> {
  const errors: FieldErrors = {};
  const projectId = typeof body.project_id === 'string' ? body.project_id : '';
  if (!projectId) errors.project_id = 'Choose a project.';
  const model = modelOf(String(body.model ?? ''));
  if (!model) errors.model = 'Choose Vela 4.5, Vela 4 Turbo or Vela Image 4.';
  const prompt = text(body, 'prompt');
  if (!prompt) errors.prompt = MESSAGES.prompt;
  else if (prompt.length > 1000) errors.prompt = MESSAGES.promptLong;
  const aspect = ASPECTS.find((choice) => choice === body.aspect);
  if (!aspect) errors.aspect = 'Choose 16:9, 9:16 or 1:1.';
  const video = model?.kind !== 'image';
  const duration = video ? DURATIONS.find((choice) => choice === body.duration) ?? null : null;
  if (video && duration === null) errors.duration = 'Choose 5 seconds or 10 seconds.';
  if (!video && body.duration != null) errors.duration = 'An image has no length.';
  const count = body.image_count;
  const imageCount =
    !video && Number.isInteger(count) && (count as number) >= IMAGE_COUNT_MIN && (count as number) <= IMAGE_COUNT_MAX
      ? (count as number)
      : null;
  if (!video && imageCount === null) errors.image_count = 'Choose 1 to 4 images.';
  if (video && count != null) errors.image_count = 'A video has no image count.';
  return finish(errors, {
    project_id: projectId,
    model: model!,
    prompt,
    duration,
    image_count: imageCount,
    aspect: aspect!,
  });
}

export interface EnquiryRequest {
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
}

export function checkEnquiry(body: Body): Checked<EnquiryRequest> {
  const errors: FieldErrors = {};
  const source = body.source === 'licensing' ? 'licensing' : body.source === 'contact' ? 'contact' : null;
  if (!source) errors.source = 'Unknown enquiry form.';
  const licensing = source === 'licensing';
  const firstName = text(body, 'first_name');
  const lastName = text(body, 'last_name');
  const fullName = text(body, 'full_name');
  if (licensing) {
    if (!within(fullName, 1, 120)) errors.full_name = 'Enter your full name.';
  } else {
    if (!within(firstName, 1, 80)) errors.first_name = 'Enter your first name.';
    if (!within(lastName, 1, 80)) errors.last_name = 'Enter your last name.';
  }
  const email = checkEmail(body, errors);
  const company = text(body, 'company');
  if (!within(company, 1, 120)) errors.company = 'Enter your company.';
  const companySize = typeof body.company_size === 'string' ? body.company_size : '';
  if (!COMPANY_SIZES.includes(companySize)) errors.company_size = 'Choose a company size.';
  const industry = typeof body.industry === 'string' ? body.industry : '';
  if (!INDUSTRIES.includes(industry)) errors.industry = 'Choose an industry.';
  const known = PRODUCTS.map((product) => product.id);
  const products = Array.isArray(body.products) ? body.products : [];
  if (!licensing && (!products.length || products.some((p) => !known.includes(p as string)))) {
    errors.products = 'Choose at least one product.';
  }
  const message = text(body, 'message');
  if (!within(message, 10, 2000)) errors.message = 'Write a message of 10 to 2,000 characters.';
  return finish(errors, {
    source: source ?? 'contact',
    first_name: licensing ? null : firstName,
    last_name: licensing ? null : lastName,
    full_name: licensing ? fullName : null,
    email,
    company,
    company_size: companySize,
    industry,
    products: licensing ? null : known.filter((id) => products.includes(id)),
    message,
  });
}
