// The header's `searchbox "Search"`. Submitting goes to /search?scope=<scope>&q=<text> (scope is code, or the current scope when
// already on /search). On /search the box shows the page's `q`; the search page itself has no second search box.
import { useLayoutEffect, useState } from "preact/hooks";
import { navigate, useRoute } from "../router.ts";
import { Icon } from "../ui/icons.tsx";

export function SearchForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const route = useRoute();
  const onSearch = route.path === "/search";
  const q = onSearch ? (route.query.get("q") ?? "") : "";
  const scope = onSearch ? (route.query.get("scope") ?? "code") : "code";
  const [value, setValue] = useState(q);
  useLayoutEffect(() => setValue(q), [q, onSearch]);
  return (
    <form
      role="search"
      class="sp-search"
      onSubmit={(event) => {
        event.preventDefault();
        navigate(`/search?${new URLSearchParams({ scope, q: value }).toString()}`);
        onSubmitted?.();
      }}
    >
      <Icon name="search" size={18} class="sp-search__icon" />
      <input
        type="search"
        name="q"
        class="sp-search__input"
        aria-label="Search"
        placeholder="Search code"
        autocomplete="off"
        value={value}
        onInput={(event) => setValue(event.currentTarget.value)}
      />
    </form>
  );
}
