const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_gjErsVQC51po@ep-dawn-star-a1cdfi8b.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false },
});

async function ensureTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS license_keys (
      id SERIAL PRIMARY KEY,
      key VARCHAR(64) NOT NULL UNIQUE,
      status VARCHAR(10) DEFAULT 'active',
      key_type VARCHAR(10) DEFAULT 'free',
      device_id VARCHAR(64) DEFAULT NULL,
      note VARCHAR(255) DEFAULT NULL,
      expires_at TIMESTAMP DEFAULT NULL,
      last_used TIMESTAMP DEFAULT NULL,
      given_ip VARCHAR(45) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const action = req.query.action || (req.body && req.body.action);
  const adminPass = req.query.admin_pass || (req.body && req.body.admin_pass);

  // Simple auth
  if (adminPass !== 'Phuonguyen2409') {
    return res.status(403).json({ status: 'error', message: 'Unauthorized' });
  }

  let client;
  try {
    client = await pool.connect();
    await ensureTables(client);

    if (action === 'list_keys') {
      const result = await client.query(
        "SELECT id, key, status, key_type, device_id, expires_at, last_used, created_at FROM license_keys ORDER BY created_at DESC LIMIT 100"
      );
      client.release();
      return res.status(200).json({ status: 'success', keys: result.rows });
    }

    if (action === 'add_key') {
      const key = req.query.key || (req.body && req.body.key);
      const key_type = req.query.key_type || (req.body && req.body.key_type) || 'free';
      const expires_at = req.query.expires_at || (req.body && req.body.expires_at) || null;
      const note = req.query.note || (req.body && req.body.note) || null;

      if (!key) {
        client.release();
        return res.status(200).json({ status: 'error', message: 'Key required' });
      }

      await client.query(
        "INSERT INTO license_keys (key, status, key_type, expires_at, note) VALUES ($1, 'active', $2, $3, $4) ON CONFLICT (key) DO NOTHING",
        [key, key_type, expires_at, note]
      );
      client.release();
      return res.status(200).json({ status: 'success', message: 'Key added: ' + key });
    }

    if (action === 'delete_key') {
      const key = req.query.key || (req.body && req.body.key);
      await client.query("DELETE FROM license_keys WHERE key = $1", [key]);
      client.release();
      return res.status(200).json({ status: 'success', message: 'Key deleted' });
    }

    if (action === 'reset_device') {
      const key = req.query.key || (req.body && req.body.key);
      await client.query("UPDATE license_keys SET device_id = NULL WHERE key = $1", [key]);
      client.release();
      return res.status(200).json({ status: 'success', message: 'Device reset' });
    }

    if (action === 'stats') {
      const total = await client.query("SELECT COUNT(*) as cnt FROM license_keys");
      const active = await client.query("SELECT COUNT(*) as cnt FROM license_keys WHERE status = 'active'");
      const used = await client.query("SELECT COUNT(*) as cnt FROM license_keys WHERE device_id IS NOT NULL");
      client.release();
      return res.status(200).json({
        status: 'success',
        total: parseInt(total.rows[0].cnt),
        active: parseInt(active.rows[0].cnt),
        used: parseInt(used.rows[0].cnt),
      });
    }

    client.release();
    return res.status(200).json({ status: 'error', message: 'Unknown action' });

  } catch (err) {
    if (client) try { client.release(); } catch(e) {}
    return res.status(200).json({ status: 'error', message: err.message });
  }
};
