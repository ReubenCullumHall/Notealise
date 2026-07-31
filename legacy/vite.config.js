import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const configDir = path.dirname(fileURLToPath(import.meta.url))

const API_BASE = '/api/vault'

/* Dev-only: serves real .md files from VAULT_DIR over a tiny REST API, so the
   browser never needs the File System Access API (Chromium-only, breaks the
   OS/browser parity the Electron app depends on for looking the same
   everywhere). Files are flat inside VAULT_DIR — legacy has no real nested
   folders on disk, only the virtual org sidecar (storage.js loadOrg/saveOrg).
   Same path-escape boundary as main/vault.ts rule 6/7: resolve, then check
   the result never leaves VAULT_DIR. */
function vaultApi(vaultDir) {
  return {
    name: 'vault-api',
    configureServer(server) {
      server.middlewares.use(API_BASE, async (req, res, next) => {
        if (!vaultDir) {
          res.statusCode = 404
          res.end('VAULT_DIR not configured')
          return
        }

        const send = (code, body) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }

        // req.url is already stripped of the API_BASE mount prefix
        const rawName = decodeURIComponent((req.url || '/').replace(/^\/+/, ''))

        try {
          if (req.method === 'GET' && rawName === '') {
            const entries = await fs.readdir(vaultDir, { withFileTypes: true })
            const notes = []
            for (const entry of entries) {
              if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
              const full = path.join(vaultDir, entry.name)
              const [content, stat] = await Promise.all([
                fs.readFile(full, 'utf8'),
                fs.stat(full),
              ])
              notes.push({ name: entry.name, content, modified: stat.mtimeMs })
            }
            send(200, { name: path.basename(vaultDir), notes })
            return
          }

          // every other route addresses a single file by name
          if (!rawName || rawName.includes('/') || rawName.includes('\\') || rawName.includes('..')) {
            send(400, { error: 'invalid note name' })
            return
          }
          const target = path.resolve(vaultDir, rawName)
          if (path.dirname(target) !== vaultDir) {
            send(400, { error: 'note name escapes vault' })
            return
          }

          if (req.method === 'PUT') {
            let body = ''
            for await (const chunk of req) body += chunk
            await fs.writeFile(target, body, 'utf8')
            send(200, { ok: true })
            return
          }

          if (req.method === 'DELETE') {
            await fs.rm(target, { force: true })
            send(200, { ok: true })
            return
          }

          next()
        } catch (err) {
          send(500, { error: String(err && err.message ? err.message : err) })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, configDir, '')
  const vaultDir = env.VAULT_DIR ? path.resolve(env.VAULT_DIR) : null
  return {
    plugins: [react(), vaultApi(vaultDir)],
  }
})
