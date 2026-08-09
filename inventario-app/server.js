const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, query } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-este-secreto-en-produccion';
const DB_RETRY_MS = Number(process.env.DB_RETRY_MS || 5000);
let dbReady = false;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// Keep frontend reachable even if the database is temporarily unavailable.
app.use('/api', (req, res, next) => {
  if(dbReady){
    return next();
  }
  return res.status(503).json({ error: 'Base de datos no disponible, intenta en unos segundos' });
});

const CATEGORY_PREFIX = {
  COMPUTADORAS: 'PC',
  MOUSE: 'MOU',
  ROUTERS: 'ROU',
  IMPRESORAS: 'IMP',
  TECLADOS: 'TEC',
  MONITORES: 'MON'
};

function getCategoryPrefix(category){
  return CATEGORY_PREFIX[category] || String(category || 'GEN').slice(0, 3).toUpperCase();
}

function toClientComputer(row){
  return {
    id: row.id,
    Identificador: row.identificador,
    Categoria: row.categoria,
    Marca: row.marca,
    Modelo: row.modelo,
    Estado: row.estado,
    Ubicacion: row.ubicacion,
    Notas: row.notas,
    ImagenPath: row.imagen_path,
    FechaRegistro: row.fecha_registro
  };
}

function signUser(user){
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: '7d'
  });
}

function requireAuth(req, res, next){
  const auth = req.headers.authorization || '';
  const [type, token] = auth.split(' ');

  if(type !== 'Bearer' || !token){
    return res.status(401).json({ error: 'No autenticado' });
  }

  try{
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function requireAdmin(req, res, next){
  if(req.user.role !== 'admin'){
    return res.status(403).json({ error: 'Sólo admin puede eliminar' });
  }
  return next();
}

async function getNextIdentifier(category){
  const result = await query(
    `INSERT INTO counters (category, n)
     VALUES ($1, 1)
     ON CONFLICT (category)
     DO UPDATE SET n = counters.n + 1
     RETURNING n`,
    [category]
  );

  const n = result.rows[0].n;
  const prefix = getCategoryPrefix(category);
  return `${prefix}-${n}`;
}

async function renumberCategory(client, category){
  const prefix = getCategoryPrefix(category);

  await client.query(
    `WITH ordered AS (
       SELECT id, row_number() OVER (ORDER BY fecha_registro ASC, id ASC) AS n
       FROM computers
       WHERE categoria = $1
     )
     UPDATE computers AS c
     SET identificador = $2 || '-' || ordered.n
     FROM ordered
     WHERE c.id = ordered.id`,
    [category, prefix]
  );

  const counterResult = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM computers
     WHERE categoria = $1`,
    [category]
  );

  const total = counterResult.rows[0]?.total || 0;
  await client.query(
    `INSERT INTO counters (category, n)
     VALUES ($1, $2)
     ON CONFLICT (category)
     DO UPDATE SET n = EXCLUDED.n`,
    [category, total]
  );
}

async function ensureSchema(){
  await query(
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  await query(
    `CREATE TABLE IF NOT EXISTS counters (
      category TEXT PRIMARY KEY,
      n INTEGER NOT NULL DEFAULT 0
    )`
  );

  await query(
    `CREATE TABLE IF NOT EXISTS computers (
      id SERIAL PRIMARY KEY,
      identificador TEXT UNIQUE,
      categoria TEXT NOT NULL,
      marca TEXT,
      modelo TEXT,
      estado TEXT,
      ubicacion TEXT,
      notas TEXT,
      imagen_path TEXT,
      fecha_registro TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );
}

async function ensureAdminUser(){
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const existingAdmin = await query('SELECT id FROM users WHERE username = $1', ['admin']);

  if(existingAdmin.rows.length > 0){
    await query(
      `UPDATE users
       SET password_hash = $1,
           role = 'admin'
       WHERE username = 'admin'`,
      [passwordHash]
    );
    console.log('Usuario admin actualizado con ADMIN_PASSWORD.');
    return;
  }

  await query(
    `INSERT INTO users (username, password_hash, role)
     VALUES ($1, $2, 'admin')`,
    ['admin', passwordHash]
  );

  console.log('Usuario admin inicial creado (usuario: admin).');
}

function sleep(ms){
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initDatabaseWithRetry(){
  while(true){
    try{
      await ensureSchema();
      await ensureAdminUser();
      dbReady = true;
      console.log('Base de datos lista.');
      return;
    } catch (err){
      dbReady = false;
      console.error(`No se pudo inicializar la base de datos. Reintentando en ${DB_RETRY_MS}ms...`, err.message);
      await sleep(DB_RETRY_MS);
    }
  }
}

app.get('/health', async (_req, res) => {
  try{
    await query('SELECT 1');
    return res.json({ ok: true });
  } catch (err){
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try{
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if(!username || !password){
      return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
    }

    if(password.length < 4){
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
    }

    const existing = await query('SELECT id FROM users WHERE username = $1', [username]);
    if(existing.rows.length > 0){
      return res.status(409).json({ error: 'Usuario existe' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, 'user')`,
      [username, passwordHash]
    );

    return res.status(201).json({ ok: true });
  } catch (err){
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try{
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    const result = await query(
      `SELECT id, username, password_hash, role
       FROM users
       WHERE username = $1`,
      [username]
    );

    if(result.rows.length === 0){
      return res.status(401).json({ error: 'Usuario/contraseña incorrectos' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if(!valid){
      return res.status(401).json({ error: 'Usuario/contraseña incorrectos' });
    }

    const token = signUser(user);
    return res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (err){
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try{
    const result = await query('SELECT id, username, role FROM users WHERE id = $1', [req.user.sub]);
    if(result.rows.length === 0){
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    return res.json({ user: result.rows[0] });
  } catch (err){
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/computers', requireAuth, async (_req, res) => {
  try{
    const result = await query(
      `SELECT id, identificador, categoria, marca, modelo, estado, ubicacion, notas, imagen_path, fecha_registro
       FROM computers
       ORDER BY id DESC`
    );
    return res.json({ items: result.rows.map(toClientComputer) });
  } catch (err){
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/computers/:id', requireAuth, async (req, res) => {
  try{
    const id = Number(req.params.id);
    const result = await query(
      `SELECT id, identificador, categoria, marca, modelo, estado, ubicacion, notas, imagen_path, fecha_registro
       FROM computers
       WHERE id = $1`,
      [id]
    );
    if(result.rows.length === 0){
      return res.status(404).json({ error: 'Equipo no encontrado' });
    }
    return res.json({ item: toClientComputer(result.rows[0]) });
  } catch (err){
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/computers', requireAuth, async (req, res) => {
  try{
    const categoria = String(req.body.Categoria || '').trim();
    if(!categoria){
      return res.status(400).json({ error: 'Categoría obligatoria' });
    }

    const identificador = req.body.Identificador || (await getNextIdentifier(categoria));
    const result = await query(
      `INSERT INTO computers (identificador, categoria, marca, modelo, estado, ubicacion, notas, imagen_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, identificador, categoria, marca, modelo, estado, ubicacion, notas, imagen_path, fecha_registro`,
      [
        identificador,
        categoria,
        req.body.Marca || '',
        req.body.Modelo || '',
        req.body.Estado || '',
        req.body.Ubicacion || '',
        req.body.Notas || '',
        req.body.ImagenPath || null
      ]
    );

    return res.status(201).json({ item: toClientComputer(result.rows[0]) });
  } catch (err){
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/computers/:id', requireAuth, async (req, res) => {
  try{
    const id = Number(req.params.id);
    const client = await pool.connect();
    try{
      await client.query('BEGIN');
      const existing = await client.query('SELECT * FROM computers WHERE id = $1', [id]);
      if(existing.rows.length === 0){
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Equipo no encontrado' });
      }

      const row = existing.rows[0];
      const categoria = req.body.Categoria || row.categoria;

      const result = await client.query(
        `UPDATE computers
         SET identificador = $1,
             categoria = $2,
             marca = $3,
             modelo = $4,
             estado = $5,
             ubicacion = $6,
             notas = $7,
             imagen_path = $8
         WHERE id = $9
         RETURNING id, identificador, categoria, marca, modelo, estado, ubicacion, notas, imagen_path, fecha_registro`,
        [
          req.body.Identificador || row.identificador,
          categoria,
          req.body.Marca ?? row.marca,
          req.body.Modelo ?? row.modelo,
          req.body.Estado ?? row.estado,
          req.body.Ubicacion ?? row.ubicacion,
          req.body.Notas ?? row.notas,
          req.body.ImagenPath ?? row.imagen_path,
          id
        ]
      );

      if(categoria !== row.categoria){
        await renumberCategory(client, row.categoria);
        await renumberCategory(client, categoria);
      }

      await client.query('COMMIT');
      return res.json({ item: toClientComputer(result.rows[0]) });
    } catch (err){
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err){
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/computers/:id/image', requireAuth, async (req, res) => {
  try{
    const id = Number(req.params.id);
    const result = await query(
      `UPDATE computers
       SET imagen_path = $1
       WHERE id = $2
       RETURNING id, identificador, categoria, marca, modelo, estado, ubicacion, notas, imagen_path, fecha_registro`,
      [req.body.ImagenPath || null, id]
    );

    if(result.rows.length === 0){
      return res.status(404).json({ error: 'Equipo no encontrado' });
    }

    return res.json({ item: toClientComputer(result.rows[0]) });
  } catch (err){
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/computers/:id', requireAuth, requireAdmin, async (req, res) => {
  try{
    const id = Number(req.params.id);
    const client = await pool.connect();
    try{
      await client.query('BEGIN');
      const existing = await client.query('SELECT categoria FROM computers WHERE id = $1', [id]);
      if(existing.rows.length === 0){
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Equipo no encontrado' });
      }

      const category = existing.rows[0].categoria;
      const result = await client.query('DELETE FROM computers WHERE id = $1 RETURNING id', [id]);
      if(result.rows.length === 0){
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Equipo no encontrado' });
      }

      await renumberCategory(client, category);
      await client.query('COMMIT');
    } catch (err){
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return res.json({ ok: true });
  } catch (err){
    return res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  if(req.path.startsWith('/api/')){
    return res.status(404).json({ error: 'Ruta no encontrada' });
  }
  return res.sendFile(path.join(__dirname, 'index.html'));
});

async function bootstrap(){
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Inventario app escuchando en 0.0.0.0:${PORT}`);
  });

  await initDatabaseWithRetry();
}

bootstrap().catch((err) => {
  console.error('Error al iniciar la aplicación:', err);
  pool.end();
});