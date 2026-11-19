export class ApiError extends Error {
  constructor(status, payload) {
    const error = (payload && payload.error) || {};
    super(error.message || 'Darkframe could not finish that request.');
    this.status = status;
    this.code = error.code || 'error';
    this.fields = (payload && payload.fields) || null;
    this.mismatches = error.mismatches || null;
  }
}

async function parse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

export async function api(method, path, body, options = {}) {
  const headers = { ...(options.headers || {}) };
  let payload;
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(path, {
    method,
    headers,
    body: payload,
    credentials: 'same-origin',
    signal: options.signal,
  });
  if (response.status === 204) return null;
  const parsed = await parse(response);
  if (!response.ok) throw new ApiError(response.status, parsed);
  return parsed;
}

/** Uploads raw bytes, reporting whole-percent progress as it goes. */
export function upload(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', path, true);
    request.setRequestHeader('Content-Type', file.type || 'image/fits');
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(Math.floor((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener('load', () => {
      let parsed = null;
      try {
        parsed = JSON.parse(request.responseText);
      } catch (_) {
        parsed = null;
      }
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve(parsed);
      } else {
        reject(new ApiError(request.status, parsed));
      }
    });
    request.addEventListener('error', () =>
      reject(new ApiError(0, { error: { message: 'The upload did not finish.' } })),
    );
    onProgress(0);
    request.send(file);
  });
}
