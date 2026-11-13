export function originalKey(documentId: string): string {
  return `documents/${documentId}/original.pdf`;
}
export function completedKey(documentId: string): string {
  return `documents/${documentId}/completed.pdf`;
}
export function templateOriginalKey(templateId: string): string {
  return `templates/${templateId}/original.pdf`;
}
