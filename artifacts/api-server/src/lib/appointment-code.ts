import { eq } from "drizzle-orm";
import { db, appointmentsTable } from "@workspace/db";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

export async function generateUniqueAppointmentCode(): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = randomCode();
    const existing = await db
      .select({ id: appointmentsTable.id })
      .from(appointmentsTable)
      .where(eq(appointmentsTable.appointmentCode, code));
    if (existing.length === 0) return code;
  }
  return randomCode();
}
