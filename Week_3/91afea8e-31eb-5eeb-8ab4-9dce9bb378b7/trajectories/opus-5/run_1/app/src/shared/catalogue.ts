/** The published category set, shared by the seed and the facet labels. */

export const CATEGORIES = [
  { slug: 'kitchen', name: 'Kitchen', gst: 5, commission: 10, returnDays: 10 },
  { slug: 'fashion', name: 'Fashion', gst: 5, commission: 15, returnDays: 7 },
  { slug: 'electronics', name: 'Electronics', gst: 18, commission: 7, returnDays: 7 },
  { slug: 'beverages', name: 'Beverages', gst: 40, commission: 8, returnDays: 0 },
] as const;

export function categoryName(slug: string): string {
  return CATEGORIES.find((category) => category.slug === slug)?.name ?? slug;
}
