import cookieParser from 'cookie-parser'
import express, { type ErrorRequestHandler } from 'express'
import { authRouter } from './routes/auth.js'
import { matchRouter } from './routes/match.js'
import { resumesRouter } from './routes/resumes.js'
import { templatesRouter } from './routes/templates.js'
import { HttpError } from './utils/http-error.js'
import mongoose from 'mongoose'

export const app = express()

app.use(express.json({ limit: '64kb' }))
app.use(express.urlencoded({ extended: false, limit: '10kb' }))
app.use(cookieParser())

// Liveness: Is the API process responsive?
app.get('/api/v1/health/live', (_request, response) => {
  response.status(200).json({
    status: 'ok',
    service: 'api',
  })
})

// Readiness: Can the API currently access MongoDB?
app.get('/api/v1/health/ready', (_request, response) => {
  const isDatabaseConnected = mongoose.connection.readyState === 1

  if (!isDatabaseConnected) {
    response.status(503).json({
      status: 'not ready',
      database: 'disconnected',
    })
    return
  }

  response.status(200).json({
    status: 'ready',
    database: 'connected',
  })
})

app.use('/api/v1/auth', authRouter)
app.use('/api/v1/resumes', resumesRouter)
app.use('/api/v1/templates', templatesRouter)
app.use('/api/v1/match', matchRouter)

app.use((_request, response) => {
  response.status(404).json({ error: 'Route not found' })
})

const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof HttpError) {
    if (error.statusCode >= 500) {
      console.error(error)
    }

    response.status(error.statusCode).json({
      error: error.message,
      ...(error.details ? { details: error.details } : {}),
    })
    return
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  ) {
    response.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  console.error(error)
  response.status(500).json({ error: 'Internal server error' })
}

app.use(errorHandler)
