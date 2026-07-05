// Minimal `cn` helper (shadcn components import this from "@/lib/utils").
// We don't pull in clsx/tailwind-merge — for this project a truthy join is enough.
export type ClassValue = string | number | null | false | undefined

export function cn(...inputs: ClassValue[]): string {
  return inputs.filter(Boolean).join(' ')
}
