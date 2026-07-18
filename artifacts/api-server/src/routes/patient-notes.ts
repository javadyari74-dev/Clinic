import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, patientNotesTable } from "@workspace/db";
import {
  ListPatientNotesParams,
  CreatePatientNoteParams,
  CreatePatientNoteBody,
  DeletePatientNoteParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/patients/:id/notes", async (req, res): Promise<void> => {
  const params = ListPatientNotesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db.select().from(patientNotesTable)
    .where(eq(patientNotesTable.patientId, params.data.id))
    .orderBy(patientNotesTable.createdAt);
  res.json(rows);
});

router.post("/patients/:id/notes", async (req, res): Promise<void> => {
  const params = CreatePatientNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreatePatientNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [note] = await db.insert(patientNotesTable).values({
    patientId: params.data.id,
    content: parsed.data.content,
    kind: parsed.data.kind ?? "general",
  }).returning();
  res.status(201).json(note);
});

router.delete("/patient-notes/:id", async (req, res): Promise<void> => {
  const params = DeletePatientNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [note] = await db.delete(patientNotesTable).where(eq(patientNotesTable.id, params.data.id)).returning();
  if (!note) {
    res.status(404).json({ error: "یادداشت یافت نشد" });
    return;
  }
  res.sendStatus(204);
});

export default router;
