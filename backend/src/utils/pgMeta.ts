import { Prisma, type PrismaClient } from '@prisma/client';

/** PostgreSQL identifier (table/column): letters, digits, underscore; first char not digit. */
const PG_IDENT = /^[a-z_][a-z0-9_]*$/i;

export function assertPgIdent(name: string, label: string): string {
  if (!PG_IDENT.test(name)) {
    throw new Error(`Invalid PostgreSQL identifier for ${label}: ${name}`);
  }
  return name;
}

/**
 * Whether a column exists on a table in the **current** search_path schema (matches Prisma `?schema=public`).
 * Use when Prisma schema is ahead of the DB (migrations not applied) to avoid selecting missing columns.
 */
export async function columnExistsInCurrentSchema(
  prisma: PrismaClient,
  tableName: string,
  columnName: string
): Promise<boolean> {
  assertPgIdent(tableName, 'tableName');
  assertPgIdent(columnName, 'columnName');
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>(
    Prisma.sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = ${tableName}
          AND column_name = ${columnName}
      ) AS "exists"
    `
  );
  return Boolean(rows[0]?.exists);
}
