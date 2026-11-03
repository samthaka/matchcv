import { Schema, Types, model } from 'mongoose'

interface RefreshToken {
  userId: Types.ObjectId
  tokenHash: string
  expiresAt: Date
  createdAt: Date
}

const refreshTokenSchema = new Schema<RefreshToken>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  createdAt: { type: Date, default: Date.now },
})

export const RefreshTokenModel = model<RefreshToken>('RefreshToken', refreshTokenSchema)
