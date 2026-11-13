import { ROLE_FAMILIES, nameOf, type PostKind } from "../../shared/reference";

type LabelParts = { kind: PostKind; title: string | null; role_family: string | null; company_name: string };

/** A post's label as members and moderators see it. */
export function postLabel(post: LabelParts): string {
  if (post.kind === "review") return post.title ?? "";
  const role = nameOf(ROLE_FAMILIES, post.role_family ?? "");
  return post.kind === "pay_report" ? `Pay report: ${role} at ${post.company_name}` : `Interview note: ${role} at ${post.company_name}`;
}
