/* Safety library: live search with focus kept (DP-50). */
"use strict";
(() => {
  const search = document.getElementById("libSearch");
  const cat = document.getElementById("libCategory");
  const topic = document.getElementById("libTopic");
  const list = document.getElementById("articleList");
  const status = document.getElementById("articleResults");
  const empty = document.getElementById("libEmpty");
  if (!search) return;

  let token = 0;
  let announced = false;

  async function run() {
    const my = ++token;
    const params = new URLSearchParams();
    if (search.value.trim()) params.set("q", search.value.trim());
    if (cat.value) params.set("category", cat.value);
    if (topic.value) params.set("topic", topic.value);
    try {
      const resp = await fetch("/api/safety/articles?" + params.toString());
      const data = await resp.json();
      if (my !== token) return;
      list.textContent = "";
      for (const a of data.data || []) {
        const card = document.createElement("article");
        card.className = "article-card";
        const h = document.createElement("h2");
        const link = document.createElement("a");
        link.href = `/safety-library/${a.slug}`;
        link.textContent = a.title;
        h.appendChild(link);
        const p = document.createElement("p");
        p.textContent = a.summary;
        card.append(h, p);
        list.appendChild(card);
      }
      const total = (data.data || []).length;
      if (empty) empty.hidden = total > 0;
      if (status) {
        status.textContent = total === 0
          ? "No articles match your search."
          : (announced ? `${total} ${total === 1 ? "article" : "articles"}` : "");
        announced = true;
      }
    } catch (err) { /* keep the last good list */ }
  }

  let t = null;
  search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(run, 120);
  });
  cat.addEventListener("change", run);
  topic.addEventListener("change", run);
  run();
})();
