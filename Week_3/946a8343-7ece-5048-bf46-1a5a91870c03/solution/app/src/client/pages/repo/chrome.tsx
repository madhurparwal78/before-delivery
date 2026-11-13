// Small pieces the repository pages share: the title block, the ref selector.
import type { ComponentChildren, Ref } from "preact";
import { useProject } from "../../role.ts";
import { Select } from "../../ui/fields.tsx";
import type { Refs } from "./types.ts";

export function RepoTitle({
  title,
  headingRef,
  children,
}: {
  title: string;
  headingRef?: Ref<HTMLHeadingElement>;
  children?: ComponentChildren;
}) {
  const project = useProject();
  return (
    <header class="sp-repo-title">
      {project.path ? <p class="sp-kicker sp-repo-title__kicker">[ {project.path} ]</p> : null}
      <h1 ref={headingRef} tabIndex={-1} class="sp-repo-title__heading">
        {title}
      </h1>
      {children}
    </header>
  );
}

/** Branches and tags as `<option>`s, plus `current` when it is neither (a commit id from the address). */
function RefOptions({ refs, current }: { refs: Refs; current: string }) {
  const known = refs.branches.some((branch) => branch.name === current) || refs.tags.some((tag) => tag.name === current);
  return (
    <>
      {known ? null : <option value={current}>{current}</option>}
      {refs.branches.length > 0 ? (
        <optgroup label="Branches">
          {refs.branches.map((branch) => (
            <option key={branch.name} value={branch.name}>
              {branch.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {refs.tags.length > 0 ? (
        <optgroup label="Tags">
          {refs.tags.map((tag) => (
            <option key={tag.name} value={tag.name}>
              {tag.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );
}

export function RefSelect({
  label,
  name,
  refs,
  value,
  onChange,
}: {
  label: string;
  name: string;
  refs: Refs;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <Select label={label} name={name} value={value} class="sp-ref-select" onChange={(event) => onChange(event.currentTarget.value)}>
      <RefOptions refs={refs} current={value} />
    </Select>
  );
}
