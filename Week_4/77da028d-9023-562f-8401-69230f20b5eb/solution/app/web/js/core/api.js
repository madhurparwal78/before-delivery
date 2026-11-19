// The one place the browser talks to the server. Every failure is an ApiError.
export class ApiError extends Error {
  constructor(status, code, message, fields = null, detail = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.detail = detail;
  }
}

async function failure(response) {
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  const error = body && body.error ? body.error : {};
  return new ApiError(response.status, error.code || 'error', error.message || 'Something went wrong. Try again.', error.fields || null, error);
}

export async function api(method, path, { body, headers = {}, signal } = {}) {
  const options = { method, headers: { ...headers }, credentials: 'same-origin', signal };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, options);
  } catch (cause) {
    if (cause && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'network', 'Darkframe could not be reached. Check the connection and try again.');
  }
  if (response.status === 401 && !path.startsWith('/api/unlock')) {
    location.assign('/unlock');
    throw new ApiError(401, 'unauthenticated', 'Unlock your workspace first.');
  }
  if (!response.ok) throw await failure(response);
  if (response.status === 204) return null;
  return response.json();
}

// Raw upload with progress (fetch has no upload progress). Resolves with the parsed JSON body.
export function upload(method, path, file, { contentType, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, path);
    request.setRequestHeader('Content-Type', contentType);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.floor((event.loaded / event.total) * 100));
    });
    request.upload.addEventListener('load', () => { if (onProgress) onProgress(100); });
    request.addEventListener('load', () => {
      let body = null;
      try { body = JSON.parse(request.responseText); } catch { body = null; }
      if (request.status >= 200 && request.status < 300) resolve(body);
      else {
        const error = body && body.error ? body.error : {};
        reject(new ApiError(request.status, error.code || 'error', error.message || 'The file was not stored.', error.fields || null, error));
      }
    });
    request.addEventListener('error', () => reject(new ApiError(0, 'network', 'Darkframe could not be reached. Check the connection and try again.')));
    request.send(file);
  });
}
