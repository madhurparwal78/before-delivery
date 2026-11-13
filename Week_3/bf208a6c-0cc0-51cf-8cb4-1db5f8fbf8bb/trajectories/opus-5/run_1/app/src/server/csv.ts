import type { PostsListing } from '../shared/types';

const CSV_HEADER = 'post_id,section,position,title,body,author,likes,score,comments,attachment,created_at';

/** The one place CSV fields are neutralised and quoted. */
const neutralise = (field: string): string => (/^[=+\-@\t\r]/.test(field) ? `'${field}` : field);

const quote = (field: string): string => `"${neutralise(field).replace(/"/g, '""')}"`;

export const csvFileName = (boardTitle: string): string => {
  const slug = boardTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'board' : slug;
};

export const buildCsv = (listing: PostsListing): string => {
  const lines = [CSV_HEADER];
  for (const section of listing.sections) {
    for (const [index, post] of section.posts.entries()) {
      lines.push(
        [
          post.id,
          section.title,
          String(index + 1),
          post.title,
          post.body,
          post.author.display_name,
          String(post.likes),
          String(post.score),
          String(post.comments),
          post.attachment === null ? '' : post.attachment.file_name,
          post.created_at,
        ]
          .map(quote)
          .join(','),
      );
    }
  }
  return `${lines.join('\r\n')}\r\n`;
};
