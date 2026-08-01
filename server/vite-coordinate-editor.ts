import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Plugin } from 'vite'
import { coordinatePaths, persistCoordinateUpdateWithRebuild } from './coordinate-updates.js'

const runFile = promisify(execFile)

export function coordinateEditor(repositoryRoot: string): Plugin {
  const coordinateFiles = coordinatePaths(repositoryRoot)
  const buildScripts = [
    path.join(repositoryRoot, 'scripts', 'data', 'build-canonical.mjs'),
    path.join(repositoryRoot, 'scripts', 'app', 'build-learning-content.mjs'),
  ]
  const contentDirectory = path.join(repositoryRoot, '.content-build', 'course-content')
  const contentFiles = new Set([
    'learning-content.json',
    'coverage-ledger.json',
    'road-topology.json',
    'referenced-roads.geojson',
    'road-network.geojson',
  ])

  async function rebuildLearningData() {
    for (const script of buildScripts) {
      await runFile(process.execPath, ['--disable-warning=ExperimentalWarning', script], {
        cwd: repositoryRoot,
        maxBuffer: 16 * 1024 * 1024,
      })
    }
  }

  let writeQueue: Promise<unknown> = Promise.resolve()
  let ignoreSourceWatch = false

  return {
    name: 'coordinate-editor',
    configureServer(server) {
      server.middlewares.use('/api/content', (request, response, next) => {
        if (request.method !== 'GET') return next()
        const name = decodeURIComponent((request.url ?? '').replace(/^\/+/, ''))
        if (!contentFiles.has(name)) {
          response.statusCode = 404
          response.end('Course content file not found.')
          return
        }
        void readFile(path.join(contentDirectory, name))
          .then((body) => {
            response.statusCode = 200
            response.setHeader(
              'Content-Type',
              name.endsWith('.geojson') ? 'application/geo+json' : 'application/json',
            )
            response.setHeader('Cache-Control', 'no-store')
            response.end(body)
          })
          .catch((error: NodeJS.ErrnoException) => {
            response.statusCode = error.code === 'ENOENT' ? 404 : 500
            response.end(error.message)
          })
      })
      server.watcher.add(coordinateFiles.source)
      server.watcher.on('change', (changedPath) => {
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
      server.middlewares.use('/api/coordinates', (request, response, next) => {
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
