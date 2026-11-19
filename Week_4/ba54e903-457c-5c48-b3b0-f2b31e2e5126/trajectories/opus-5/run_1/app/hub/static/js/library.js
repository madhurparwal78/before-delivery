// The safety library: results follow typing, and the count is announced in one region.

import { api, element, latestInputGuard } from './api.js';

const search = document.getElementById('article-q');
const category = document.getElementById('filter-category');
const topic = document.getElementById('filter-topic');
const results = document.getElementById('article-results');
const list = document.getElementById('article-list');
const emptyLine = document.getElementById('article-empty');
const guard = latestInputGuard();

function card(article) {
  return element('article', { class: 'entry-card' }, [
    element('h2', {}, [
      element('a', { href: '/safety-library/' + article.slug, text: article.title }),
    ]),
    element('p', { class: 'tags', text: article.category + ' · ' + article.topic }),
    element('p', { text: article.summary }),
  ]);
}

async function load() {
  const ticket = guard.start();
  const query = new URLSearchParams();
  if (search.value.trim()) query.set('q', search.value.trim());
  if (category.value) query.set('category', category.value);
  if (topic.value) query.set('topic', topic.value);
  let answer;
  try {
    answer = await api('/api/safety/articles?' + query.toString(), { token: null });
  } catch (error) {
    results.textContent = 'Articles could not be loaded. Try again.';
    return;
  }
  if (!guard.current(ticket)) return;
  if (!answer.ok) {
    results.textContent = 'Articles could not be loaded. Try again.';
    return;
  }
  const articles = answer.data.data;
  list.replaceChildren(...articles.map(card));
  emptyLine.hidden = articles.length !== 0;
  results.textContent = articles.length === 0
    ? '0 articles'
    : articles.length === 1 ? '1 article' : articles.length + ' articles';
  if (articles.length === 0) emptyLine.textContent = 'No articles match your search.';
}

search.addEventListener('input', load);
category.addEventListener('change', load);
topic.addEventListener('change', load);
