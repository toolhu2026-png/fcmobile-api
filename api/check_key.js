const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_gjErsVQC51po@ep-dawn-star-a1cdfi8b.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
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
  await client.query(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id SERIAL PRIMARY KEY,
      key_id INT,
      device_id VARCHAR(64),
      ip VARCHAR(45),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Parse query string manually (Vercel fix)
  const urlModule = require('url');
  const parsed = urlModule.parse(req.url || '', true);
  const q = (req.query && Object.keys(req.query).length > 0) ? req.query : parsed.query;

  // DEBUG endpoint
  if (q.debug) {
    return res.status(200).json({
      url: req.url,
      query: req.query,
      parsed_query: parsed.query,
      q: q,
      method: req.method
    });
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  let key = '';
  let device = '';

  // 1. Tu query string
  if (q.key) {
    key = q.key.trim();
    device = (q.device || '').trim();
  }

  // 2. Tu POST body
  if (!key && req.body) {
    try {
      let bodyStr = '';
      if (typeof req.body === 'string') {
        bodyStr = req.body;
      } else if (typeof req.body === 'object') {
        if (req.body.token) {
          try {
            const outerJson = JSON.parse(Buffer.from(req.body.token, 'base64').toString('utf8'));
            const dataB64 = outerJson.data || outerJson.Data;
            if (dataB64) {
              const innerJson = JSON.parse(Buffer.from(dataB64, 'base64').toString('utf8'));
              key = innerJson.key || innerJson.Key || '';
              device = innerJson.deviceid || innerJson.device_id || innerJson.device || '';
            }
          } catch(e) {
            key = req.body.key || req.body.Key || '';
            device = req.body.device_id || req.body.device || '';
          }
        } else {
          key = req.body.key || req.body.Key || '';
          device = req.body.device_id || req.body.device || '';
        }
      }

      if (!key && bodyStr) {
        const tokenMatch = bodyStr.match(/token=([^&]+)/);
        if (tokenMatch) {
          try {
            const decoded = Buffer.from(decodeURIComponent(tokenMatch[1]), 'base64').toString('utf8');
            const outerJson = JSON.parse(decoded);
            const dataB64 = outerJson.data || outerJson.Data;
            if (dataB64) {
              const innerJson = JSON.parse(Buffer.from(dataB64, 'base64').toString('utf8'));
              key = innerJson.key || innerJson.Key || '';
              device = innerJson.deviceid || innerJson.device_id || '';
            }
          } catch(e) {}
        }
        if (!key) {
          try {
            const json = JSON.parse(bodyStr);
            key = json.key || json.Key || '';
            device = json.device_id || json.device || '';
          } catch(e) {}
        }
      }
    } catch(e) {}
  }

  if (!key) {
    return res.status(200).json({ status: 'error', message: 'Key không được để trống' });
  }

  let client;
  try {
    client = await pool.connect();
    await ensureTables(client);

    const result = await client.query(
      "SELECT * FROM license_keys WHERE key = $1 AND status = 'active' LIMIT 1",
      [key]
    );

    if (result.rows.length === 0) {
      client.release();
      return res.status(200).json({ status: 'error', message: 'Key không hợp lệ hoặc đã bị vô hiệu hóa' });
    }

    const row = result.rows[0];

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      client.release();
      return res.status(200).json({ status: 'error', message: 'Key đã hết hạn' });
    }

    if (row.key_type === 'daily' && row.device_id) {
      client.release();
      return res.status(200).json({ status: 'error', message: 'Key này đã được sử dụng rồi' });
    }

    if (!row.device_id) {
      await client.query(
        "UPDATE license_keys SET device_id = $1, last_used = NOW(), given_ip = $2 WHERE id = $3",
        [device || 'unknown', ip, row.id]
      );
    } else if (row.device_id !== device && device) {
      client.release();
      return res.status(200).json({ status: 'error', message: 'Key đã được sử dụng trên thiết bị khác' });
    } else {
      await client.query("UPDATE license_keys SET last_used = NOW() WHERE id = $1", [row.id]);
    }

    try {
      await client.query(
        "INSERT INTO usage_logs (key_id, device_id, ip) VALUES ($1, $2, $3)",
        [row.id, device || 'unknown', ip]
      );
    } catch(e) {}

    client.release();
    return res.status(200).json({
      status: 'success',
      trang_thai: 'thanh_cong',
      message: 'OK',
      data: '',
      lib: '',
      key: key,
      ngay_het_han: row.expires_at || '',
    });

  } catch (err) {
    if (client) try { client.release(); } catch(e) {}
    return res.status(200).json({ status: 'error', message: 'Loi ket noi: ' + err.message });
  }
};
