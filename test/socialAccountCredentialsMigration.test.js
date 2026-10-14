const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  __dirname,
  "..",
  "supabase",
  "separate_social_account_credentials.sql"
);

assert.equal(fs.existsSync(migrationPath), true, "credential migration must exist");

const sql = fs.readFileSync(migrationPath, "utf8").toLowerCase();
const createIndex = sql.indexOf("create table if not exists public.social_account_credentials");
const copyIndex = sql.indexOf("insert into public.social_account_credentials");
const verifyIndex = sql.indexOf("credential migration verification failed");
const dropAccessIndex = sql.indexOf("drop column if exists access_token");
const dropRefreshIndex = sql.indexOf("drop column if exists refresh_token");

assert.ok(sql.includes("begin;"), "migration must be transactional");
assert.ok(createIndex >= 0, "private credential table must be created");
assert.match(sql, /social_account_id\s+uuid\s+primary key/);
assert.match(sql, /references\s+public\.social_accounts\s*\(id\)\s+on delete cascade/);
assert.match(sql, /alter table public\.social_account_credentials enable row level security/);
assert.match(sql, /revoke all on table public\.social_account_credentials from anon, authenticated/);
assert.ok(copyIndex > createIndex, "legacy credentials must be copied after table creation");
assert.match(sql, /on conflict\s*\(social_account_id\)\s*do update/);
assert.ok(verifyIndex > copyIndex, "copied credentials must be verified");
assert.ok(dropAccessIndex > verifyIndex, "access token column must be dropped only after verification");
assert.ok(dropRefreshIndex > verifyIndex, "refresh token column must be dropped only after verification");
assert.match(sql, /raise exception 'credential migration verification failed/);
assert.ok(sql.includes("commit;"), "migration must commit explicitly");

console.log("ok - private Threads credential migration contract");
