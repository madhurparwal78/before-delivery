/** Hands bytes to the browser as a file download. */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Fetches a same-origin file and saves it; the response is returned so the caller can read a refusal. */
export async function downloadFile(path: string, fileName: string): Promise<Response> {
  const response = await fetch(path, { credentials: 'same-origin' })
  if (response.ok) saveBlob(await response.blob(), fileName)
  return response
}
