import cookieParser from 'cookie-parser'
import express, { type ErrorRequestHandler } from 'express'
import { authRouter } from './routes/auth.js'
import { HttpError } from './utils/http-error.js'

export const app = express()

app.use(express.json({ limit: '10kb' }))
app.use(express.urlencoded({ extended: false, limit: '10kb' }))
app.use(cookieParser())
app.get('/api/v1/health', (_request, response) => {
  response.json({ status: 'ok', service: 'api' })
})
app.use('/api/v1/auth', authRouter)

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
