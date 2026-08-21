import { POST as submitEvidence } from "@/app/api/gates/evidence/route";

export async function POST(request: Request, context: { params: Promise<{ gateId: string }> }) {
  const body = await request.json();
  const { gateId } = await context.params;
  return submitEvidence(
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify({ ...body, gateId }),
    }),
  );
}
