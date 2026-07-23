/// <reference types="vitest/config" />
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { coordinatePaths, persistCoordinateUpdateWithRebuild } from './server/coordinate-updates.js'

const runFile = promisify(execFile)
const repositoryRoot = import.meta.dirname
const coordinateFiles = coordinatePaths(repositoryRoot)
const buildScripts = [
  path.join(repositoryRoot, 'scripts', 'data', 'build-canonical.mjs'),
  path.join(repositoryRoot, 'scripts', 'app', 'build-learning-content.mjs'),
]

async function rebuildLearningData() {
  for (const script of buildScripts) {
    await runFile(process.execPath, ['--disable-warning=ExperimentalWarning', script], {
      cwd: repositoryRoot,
      maxBuffer: 16 * 1024 * 1024,
    })
  }
}

function coordinateEditor() {
  let writeQueue: Promise<unknown> = Promise.resolve()
  let ignoreSourceWatch = false
  return {
    name: 'coordinate-editor',
    configureServer(server: any) {
      server.watcher.add(coordinateFiles.source)
      server.watcher.on('change', (changedPath: string) => {
        if (path.resolve(changedPath) !== path.resolve(coordinateFiles.source) || ignoreSourceWatch) return
        writeQueue = writeQueue.then(rebuildLearningData, rebuildLearningData)
        writeQueue.then(() => {
          server.config.logger.info('Canonical taxi data changed; learning data rebuilt.')
          server.ws.send({ type: 'full-reload' })
        }).catch((error: Error) => {
          server.config.logger.error(`Taxi data rebuild failed: ${error.message}`)
          server.ws.send({
            type: 'error',
            err: { message: `Taxi data rebuild failed: ${error.message}`, stack: error.stack ?? '' },
          })
        })
      })
      server.middlewares.use('/api/coordinates', (request: any, response: any, next: () => void) => {
        if (request.method !== 'PATCH') return next()
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => {
          body += chunk
          if (body.length > 64_000) request.destroy(new Error('Coordinate update body is too large.'))
        })
        request.on('end', () => {
          const run = async () => {
            ignoreSourceWatch = true
            try {
              return await persistCoordinateUpdateWithRebuild(
                coordinateFiles.source,
                coordinateFiles.audit,
                JSON.parse(body),
                rebuildLearningData,
              )
            } finally {
              setTimeout(() => {
                ignoreSourceWatch = false
              }, 250)
            }
          }
          writeQueue = writeQueue.then(run, run)
          writeQueue.then((result) => {
            response.statusCode = 200
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ ok: true, update: result }))
          }).catch((error: Error) => {
            response.statusCode = error instanceof SyntaxError ? 400 : 409
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ ok: false, error: error.message }))
          })
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), coordinateEditor()],
  server: {
    watch: {
      // Builders update these after an in-app coordinate save. The current UI
      // already has the saved coordinate, so reloading would only discard
      // navigation and session state. Direct canonical-source edits still
      // trigger the explicit full reload above.
      ignored: [
        '**/data/generated/**',
        '**/data/reports/**',
        '**/public/data/**',
      ],
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
})
