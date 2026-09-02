import { shareBaseUrl } from "@/lib/env";

/** Public share URL for a slug, e.g. https://jtylerray.com/v/abc12345 */
export function shareUrl(slug: string): string {
  return `${shareBaseUrl()}/v/${slug}`;
}
