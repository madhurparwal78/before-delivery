import { useEffect, useRef } from 'react'
import { useApp } from '../state'

export interface Problem { field: string; label: string; message: string; focus: () => void }

/** `region "Problems"`: the heading and one link per problem, `{field label}: {message}`; following a link focuses its field. With `takeFocus` the region is focused whenever a new list arrives. */
export function Problems({ problems, takeFocus = false }: { problems: Problem[]; takeFocus?: boolean }) {
  const app = useApp()
  const region = useRef<HTMLElement>(null)
  useEffect(() => {
    if (takeFocus) region.current?.focus()
  }, [problems, takeFocus])
  if (!problems.length) return null
  return (
    <section ref={region} tabIndex={-1} aria-label={app.t('ui.problems')} className="problems">
      <h2>{app.t('problems.heading', { 'count:problem': problems.length })}</h2>
      <ul>
        {problems.map((problem) => (
          <li key={problem.field}>
            <a href={`#${problem.field}`} onClick={(event) => { event.preventDefault(); problem.focus() }}>{`${problem.label}: ${problem.message}`}</a>
          </li>
        ))}
      </ul>
    </section>
  )
}
