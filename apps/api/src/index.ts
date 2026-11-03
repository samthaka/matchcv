import 'dotenv/config'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { app } from './app.js'
import { getMongoUri, validateJwtSecrets } from './config.js'
import { RefreshTokenModel } from './models/refresh-token.js'
import { ResumeModel } from './models/resume.js'
import { UserModel } from './models/user.js'

dotenv.config({ path: '../../.env' })

const port = Number(process.env.PORT ?? 3000)

async function start(): Promise<void> {
  validateJwtSecrets()
  await mongoose.connect(getMongoUri())
  await Promise.all([UserModel.init(), RefreshTokenModel.init(), ResumeModel.init()])

  app.listen(port, () => {
    console.info(`MatchCV API listening on http://localhost:${port}`)
  })
}

start().catch((error: unknown) => {
  console.error('Failed to start MatchCV API', error)
  process.exitCode = 1
})
