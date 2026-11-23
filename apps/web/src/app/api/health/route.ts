import { health } from "@/server";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(health());
}
