import { removeFromOpenAI } from "@/lib/docs";
import { deleteDocRecord, getDoc } from "@/lib/store";

type Ctx = RouteContext<"/api/docs/[id]">;

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const doc = await getDoc(id);
  if (!doc) return Response.json({ error: "Documento nao encontrado" }, { status: 404 });
  return Response.json(doc);
}

/** Deletes the document from the library and from OpenAI. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const doc = await getDoc(id);
  if (doc) {
    await removeFromOpenAI(doc);
    await deleteDocRecord(id);
  }
  return new Response(null, { status: 204 });
}
