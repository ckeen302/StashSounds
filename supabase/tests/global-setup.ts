import pg from "pg";
import { ADMIN_URL, TEMPLATE_DB, dbUrl, schemaSql } from "./db.ts";

/** Builds the template database once per run: shim plus every migration. */
export default async function setup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEMPLATE_DB} with (force)`);
  await admin.query(`create database ${TEMPLATE_DB}`);
  await admin.end();

  const db = new pg.Client({ connectionString: dbUrl(TEMPLATE_DB) });
  await db.connect();
  for (const sql of schemaSql()) await db.query(sql);
  await db.end();
}
