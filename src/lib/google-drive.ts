import "server-only";
import { env } from "@/lib/env";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

export type DriveFileMeta = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  parents: string[];
  trashed: boolean;
};

export class DriveError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DriveError";
    this.status = status;
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

/** Refresh-token grant with a 60s expiry margin, cached per server instance. */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  if (inflight) return inflight;

  inflight = (async () => {
    const body = new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: env("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });

    if (!response.ok) {
      cachedToken = null;
      throw new DriveError(
        `Token refresh failed: ${await response.text()}`,
        response.status,
      );
    }

    const json = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    cachedToken = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    };
    return cachedToken.value;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Test seam: drop the cached access token. */
export function resetAccessTokenCache(): void {
  cachedToken = null;
}

/**
 * Fetch with a bearer token, retrying once with a fresh token on a 401 —
 * covers a token that expired or was revoked between calls.
 */
async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const withAuth = (bearer: string): RequestInit => ({
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${bearer}` },
  });

  let response = await fetch(url, withAuth(token));
  if (response.status === 401) {
    resetAccessTokenCache();
    const fresh = await getAccessToken();
    response = await fetch(url, withAuth(fresh));
  }
  return response;
}

export type ResumableSessionInput = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  origin: string;
};

/**
 * Start a resumable upload and return the session URI the browser PUTs to.
 * `Origin` must be sent so Google includes CORS headers on the session URI.
 */
export async function createResumableSession(
  input: ResumableSessionInput,
): Promise<string> {
  const response = await driveFetch(`${UPLOAD_URL}?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      Origin: input.origin,
      "X-Upload-Content-Type": input.mimeType,
      "X-Upload-Content-Length": String(input.sizeBytes),
    },
    body: JSON.stringify({
      name: input.name,
      parents: [env("GOOGLE_DRIVE_FOLDER_ID")],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new DriveError(
      `Failed to start resumable upload: ${await response.text()}`,
      response.status,
    );
  }

  const location = response.headers.get("location");
  if (!location) {
    throw new DriveError("Drive did not return a resumable session URI", 502);
  }
  return location;
}

export async function getFileMeta(fileId: string): Promise<DriveFileMeta> {
  const url = `${FILES_URL}/${encodeURIComponent(
    fileId,
  )}?fields=id,name,mimeType,size,parents,trashed`;

  const response = await driveFetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new DriveError(
      `Failed to read file metadata: ${await response.text()}`,
      response.status,
    );
  }

  const json = (await response.json()) as {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    parents?: string[];
    trashed?: boolean;
  };

  return {
    id: json.id,
    name: json.name,
    mimeType: json.mimeType,
    size: json.size ? Number(json.size) : null,
    parents: json.parents ?? [],
    trashed: json.trashed ?? false,
  };
}

/**
 * Fetch file bytes. The upstream Response is returned untouched so the caller
 * can pipe `response.body` straight through without buffering.
 */
export async function fetchMedia(
  fileId: string,
  range?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (range) headers.Range = range;

  return driveFetch(`${FILES_URL}/${encodeURIComponent(fileId)}?alt=media`, {
    headers,
    cache: "no-store",
  });
}

/** Multipart upload for small payloads such as thumbnails. */
export async function uploadSmall(
  name: string,
  mimeType: string,
  bytes: ArrayBuffer,
): Promise<string> {
  const boundary = `yoom-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name,
    parents: [env("GOOGLE_DRIVE_FOLDER_ID")],
  });

  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const payload = new Uint8Array(head.length + bytes.byteLength + tail.length);
  payload.set(head, 0);
  payload.set(new Uint8Array(bytes), head.length);
  payload.set(tail, head.length + bytes.byteLength);

  const response = await driveFetch(`${UPLOAD_URL}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: payload,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new DriveError(
      `Thumbnail upload failed: ${await response.text()}`,
      response.status,
    );
  }

  const json = (await response.json()) as { id: string };
  return json.id;
}

export async function renameFile(fileId: string, name: string): Promise<void> {
  const response = await driveFetch(
    `${FILES_URL}/${encodeURIComponent(fileId)}?fields=id`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new DriveError(`Rename failed: ${await response.text()}`, response.status);
  }
}

export async function trashFile(fileId: string): Promise<void> {
  const response = await driveFetch(
    `${FILES_URL}/${encodeURIComponent(fileId)}?fields=id`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trashed: true }),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new DriveError(`Trash failed: ${await response.text()}`, response.status);
  }
}
