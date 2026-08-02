import type { ApiErrorResponse, ApiResponse } from "@/lib/api/types";

export type { ApiResponse, ApiErrorResponse, ApiSuccessResponse } from "@/lib/api/types";

export async function fetchApi<T>(
  url: string,
  options?: RequestInit,
): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  const json = (await response.json()) as ApiResponse<T>;

  if (!json.success) {
    throw new Error(formatApiErrorMessage(json.error));
  }

  return { data: json.data, meta: json.meta };
}

function formatApiErrorMessage(error: ApiErrorResponse["error"]): string {
  const details = error.details as
    | { fieldErrors?: Record<string, string[] | undefined> }
    | undefined;
  const fieldErrors = details?.fieldErrors;
  if (fieldErrors) {
    const messages = Object.values(fieldErrors)
      .flatMap((msgs) => msgs ?? [])
      .filter(Boolean);
    if (messages.length > 0) {
      return messages.join(". ");
    }
  }
  return error.message;
}

export function buildQueryString(
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
