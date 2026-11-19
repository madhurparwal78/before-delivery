/** The not-found page. */

export const NOT_FOUND_HEADING_ID = 'not-found-heading';

export const renderNotFoundMain = (): string =>
  '<div class="not-found">' +
  `<h1 class="case-title" id="${NOT_FOUND_HEADING_ID}" tabindex="-1">This page took a wrong turn.</h1>` +
  '<p>The address may be mistyped, or the page may have moved.</p>' +
  '<a class="button-link" href="/">Back to the homepage</a>' +
  '</div>';
