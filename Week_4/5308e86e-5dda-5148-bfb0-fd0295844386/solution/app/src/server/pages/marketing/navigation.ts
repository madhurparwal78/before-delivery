/** Header menus, account links and footer groups: one definition read by the desktop header, the narrow menu and the footer. */

export interface NavLink {
  label: string;
  href: string;
}

export interface HeaderMenu {
  id: string;
  label: string;
  links: NavLink[];
}

interface FooterGroup {
  title: string;
  links: NavLink[];
}

export const HEADER_MENUS: HeaderMenu[] = [
  {
    id: "products",
    label: "Products",
    links: [
      { label: "Business banking", href: "/business-banking" },
      { label: "Payments", href: "/business-payments" },
      { label: "Credit card", href: "/credit" },
      { label: "Treasury", href: "/treasury" },
      { label: "Invoicing", href: "/invoicing" },
      { label: "Spend management", href: "/spend-management" },
      { label: "Payroll", href: "/payroll" },
      { label: "Books", href: "/books" },
    ],
  },
  {
    id: "solutions",
    label: "Solutions",
    links: [
      { label: "Venture debt", href: "/venture-debt" },
      { label: "Working capital loans", href: "/working-capital-loans" },
    ],
  },
  {
    id: "resources",
    label: "Resources",
    links: [
      { label: "Demo", href: "/demo" },
      { label: "Plans and pricing", href: "/pricing" },
    ],
  },
  {
    id: "about",
    label: "About",
    links: [
      { label: "Contact sales", href: "/contact" },
      { label: "Open an account", href: "/signup" },
    ],
  },
];

export const PRICING_LINK: NavLink = { label: "Pricing", href: "/pricing" };
export const SESSION_LINKS: NavLink[] = [
  { label: "Dashboard", href: "/app" },
  { label: "Log in", href: "/login" },
];
export const OPEN_ACCOUNT_LINK: NavLink = { label: "Open account", href: "/signup" };

export const FOOTER_GROUPS: FooterGroup[] = [
  {
    title: "Banking",
    links: [
      { label: "Business Checking and Savings", href: "/business-banking" },
      { label: "Treasury", href: "/treasury" },
      { label: "Business Credit Cards", href: "/credit" },
      { label: "Working Capital Loans", href: "/working-capital-loans" },
      { label: "Venture Debt", href: "/venture-debt" },
    ],
  },
  {
    title: "Platform",
    links: [
      { label: "Pricing", href: "/pricing" },
      { label: "API", href: "/contact" },
      { label: "Security", href: "/contact" },
      { label: "Status", href: "/contact" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Help Center", href: "/contact" },
      { label: "Blog", href: "/contact" },
      { label: "Events", href: "/contact" },
    ],
  },
  {
    title: "Finance Ops",
    links: [
      { label: "Payments", href: "/business-payments" },
      { label: "Bill Pay", href: "/business-payments" },
      { label: "Invoicing", href: "/invoicing" },
      { label: "Spend Management", href: "/spend-management" },
    ],
  },
];

export const PARTNER_DISCLAIMER =
  "Tallwind Labs builds the software. Your deposits are held by our partner banks, Harbor Financial and Keystone N.A., each a Member FDIC.";
