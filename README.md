# Inventario de Equipos Escolares - SQL + Fly.io

Aplicación de inventario con frontend en HTML/JS y backend en Node.js + PostgreSQL.

## Cambios aplicados

- Migración de almacenamiento local (IndexedDB) a base de datos SQL (PostgreSQL)
- Archivo de conexión a BD creado en [db.js](db.js)
- API backend creada en [server.js](server.js)
- Eliminado apartado de importación/exportación JSON en la interfaz
- Preparado para despliegue en GitHub y Fly.io

## Tecnologías

- Node.js + Express
- PostgreSQL (paquete `pg`)
- JWT para autenticación
- bcryptjs para hash de contraseñas

## Estructura principal

- [index.html](index.html): frontend
- [server.js](server.js): servidor y API REST
- [db.js](db.js): conexión SQL
- [fly.toml](fly.toml): configuración de Fly.io
- [Dockerfile](Dockerfile): imagen para despliegue
- [.env.example](.env.example): variables de entorno de ejemplo

## Configuración local

1. Instala Node.js 20+
2. Crea tu archivo `.env` usando [.env.example](.env.example)
3. Instala dependencias:

```bash
npm install
```

4. Ejecuta la app:

```bash
npm start
```

5. Abre en navegador:

```text
http://localhost:3000
```

## Usuario inicial

- Usuario: `admin`
- Contraseña por defecto: `admin123`

Puedes cambiar la contraseña inicial definiendo `ADMIN_PASSWORD` en `.env` antes del primer arranque.

## Variables de entorno

Variables clave (ver ejemplo completo en [.env.example](.env.example)):

- `PORT`
- `JWT_SECRET`
- `DATABASE_URL` (recomendado)
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` (alternativa)
- `PGSSL`
- `ADMIN_PASSWORD`

## Despliegue en GitHub

1. Inicializa git si hace falta:

```bash
git init
git add .
git commit -m "Inventario SQL listo para Fly.io"
```

2. Crea repositorio en GitHub y sube:

```bash
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git branch -M main
git push -u origin main
```

## Despliegue en Fly.io

1. Instala y autentica Fly CLI:

```bash
fly auth login
```

2. Crea o ajusta app Fly (si el nombre en [fly.toml](fly.toml) ya existe, cámbialo):

```bash
fly launch --no-deploy
```

3. Crea base PostgreSQL en Fly (si no tienes una):

```bash
fly postgres create
```

4. Asocia la base a tu app para inyectar `DATABASE_URL`:

```bash
fly postgres attach <NOMBRE_POSTGRES> --app inventario-app
```

5. Configura secreto JWT:

```bash
fly secrets set JWT_SECRET="cambia-esto-por-un-valor-seguro" --app inventario-app
```

6. Despliega:

```bash
fly deploy
```

## API principal

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/computers`
- `GET /api/computers/:id`
- `POST /api/computers`
- `PUT /api/computers/:id`
- `PATCH /api/computers/:id/image`
- `DELETE /api/computers/:id` (solo admin)

## Nota

La opción de importar/exportar JSON fue eliminada como solicitaste. Se mantiene exportación CSV por categoría.
