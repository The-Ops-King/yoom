// Deprecated: R2 storage. Retained only so the legacy /watch route compiles
// until it is deleted in the "Remove R2" task. No AWS SDK dependency.
export async function videoExists(_key: string): Promise<boolean> {
  return false;
}

export function getPublicVideoUrl(key: string): string {
  return `${process.env.R2_PUBLIC_URL ?? ""}/${key}`;
}
