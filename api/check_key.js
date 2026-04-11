const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'sql8.freesqldatabase.com',
  port: 3306,
  user: 'sql8822944',
  password: 'zCcwi2MCYH',
  database: 'sql8822944',
  connectTimeout: 10000,
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/plain');

  const key    = (req.query.key    || '').trim();
  const device = (req.query.device || '').trim();
  const ip     = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

  if (!key) {
    return res.status(200).send('Key không được để trống');
  }

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(
      "SELECT * FROM license_keys WHERE `key` = ? AND status = 'active' LIMIT 1",
      [key]
    );

    if (rows.length === 0) {
      await conn.end();
      return res.status(200).send('Key không hợp lệ hoặc đã bị vô hiệu hóa');
    }

    const row = rows[0];

    // Kiểm tra hết hạn
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      await conn.end();
      return res.status(200).send('Key đã hết hạn');
    }

    // Key daily chỉ dùng 1 lần
    if (row.key_type === 'daily' && row.device_id) {
      await conn.end();
      return res.status(200).send('Key này đã được sử dụng rồi');
    }

    // Gắn device nếu chưa có
    if (!row.device_id) {
      await conn.execute(
        "UPDATE license_keys SET device_id = ?, last_used = NOW(), given_ip = ? WHERE id = ?",
        [device || 'unknown', ip, row.id]
      );
    } else if (row.device_id !== device && device) {
      await conn.end();
      return res.status(200).send('Key đã được sử dụng trên thiết bị khác');
    } else {
      await conn.execute(
        "UPDATE license_keys SET last_used = NOW() WHERE id = ?",
        [row.id]
      );
    }

    // Ghi log
    try {
      await conn.execute(
        "INSERT INTO usage_logs (key_id, device_id, ip, created_at) VALUES (?, ?, ?, NOW())",
        [row.id, device || 'unknown', ip]
      );
    } catch(e) {}

    await conn.end();
    return res.status(200).send('OK');

  } catch (err) {
    if (conn) try { await conn.end(); } catch(e) {}
    console.error('DB Error:', err.message);
    return res.status(200).send('Loi ket noi server');
  }
};
