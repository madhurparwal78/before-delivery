import { useApp } from "../context.tsx";

export function NotFoundPage() {
  const { locale, t } = useApp();
  return (
    <section class="page narrow">
      <h1 tabIndex={-1} class="page-title">{t.notFound}</h1>
      <p><a href={`/${locale}/`}>{t.navProgramme}</a></p>
    </section>
  );
}
