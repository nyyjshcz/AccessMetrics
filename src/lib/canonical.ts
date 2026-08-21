import crypto from "node:crypto";
export function canonicalize(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
    .join(",")}}`;
}
export function sha256(data: string | Buffer) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
