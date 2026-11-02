import express from 'express'

const app = express()
const port = Number(process.env.PORT ?? 3000)

app.use(express.json())

app.get('/api/v1/health', (_request, response) => {
  response.json({ status: 'ok', service: 'api' })
})

app.listen(port, () => {
  console.info(`MatchCV API listening on http://localhost:${port}`)
})
