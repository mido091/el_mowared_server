import pool from '../src/config/db.js';
import { env } from '../src/config/env.js';

const EXECUTE_FLAG = '--execute';
const ALLOW_REMOTE_FLAG = '--allow-remote';

const PRESERVED_TABLES = new Set([
  'users',
  'site_settings',
  'schema_migrations',
  'dbmate_migrations',
]);

const isLocalDatabaseHost = (host) => {
  const normalized = `${host || ''}`.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1';
};

const quoteIdentifier = (name) => `\`${String(name).replace(/`/g, '``')}\``;

const getExistingTables = async () => {
  const [rows] = await pool.execute(
    `
      SELECT TABLE_NAME AS table_name
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = :dbName
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `,
    { dbName: env.dbName }
  );

  return rows.map((row) => row.table_name);
};

const getAutoIncrementTables = async (tableNames) => {
  if (!tableNames.length) return new Set();

  const placeholders = tableNames.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `
      SELECT TABLE_NAME AS table_name
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME IN (${placeholders})
        AND AUTO_INCREMENT IS NOT NULL
    `,
    [env.dbName, ...tableNames]
  );

  return new Set(rows.map((row) => row.table_name));
};

const main = async () => {
  const execute = process.argv.includes(EXECUTE_FLAG);
  const allowRemote = process.argv.includes(ALLOW_REMOTE_FLAG);

  if (execute && !isLocalDatabaseHost(env.dbHost) && !allowRemote) {
    throw new Error(
      `Refusing to execute cleanup against non-local DB host "${env.dbHost}". ` +
        `Run again with ${ALLOW_REMOTE_FLAG} only if you intentionally want to target this database.`
    );
  }

  const allTables = await getExistingTables();
  const tablesToPreserve = allTables.filter((table) => PRESERVED_TABLES.has(table));
  const tablesToClean = allTables.filter((table) => !PRESERVED_TABLES.has(table));
  const autoIncrementTables = await getAutoIncrementTables(tablesToClean);

  console.log('Database cleanup plan');
  console.log(`- DB: ${env.dbName}`);
  console.log(`- Host: ${env.dbHost}:${env.dbPort}`);
  console.log(`- Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`- Preserved tables: ${tablesToPreserve.join(', ') || '(none found)'}`);
  console.log(`- Tables to clean (${tablesToClean.length}): ${tablesToClean.join(', ') || '(none)'}`);

  if (!execute) {
    console.log(`\nDry run complete. Re-run with ${EXECUTE_FLAG} to apply changes.`);
    return;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const tableName of tablesToClean) {
      console.log(`Deleting rows from ${tableName}...`);
      await connection.query(`DELETE FROM ${quoteIdentifier(tableName)}`);

      if (autoIncrementTables.has(tableName)) {
        await connection.query(`ALTER TABLE ${quoteIdentifier(tableName)} AUTO_INCREMENT = 1`);
      }
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    await connection.commit();

    console.log('\nCleanup completed successfully.');
    console.log(`Preserved data remains only in: ${tablesToPreserve.join(', ') || '(none found)'}`);
  } catch (error) {
    await connection.rollback();
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    } catch {
      // Ignore reset failures after rollback attempt.
    }
    throw error;
  } finally {
    connection.release();
  }
};

main()
  .catch((error) => {
    console.error('Cleanup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
