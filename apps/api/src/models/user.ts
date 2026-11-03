import { Schema, model } from 'mongoose'

export const userRoles = ['CANDIDATE', 'ADMIN'] as const
export type UserRole = (typeof userRoles)[number]

interface User {
  email: string
  passwordHash: string
  role: UserRole
  emailVerifiedAt: Date | null
  emailVerificationTokenHash?: string
  emailVerificationTokenExpiresAt?: Date
  createdAt: Date
  updatedAt: Date
}

const userSchema = new Schema<User>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: userRoles, required: true, default: 'CANDIDATE' },
    emailVerifiedAt: { type: Date, default: null },
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationTokenExpiresAt: { type: Date, select: false },
  },
  { timestamps: true },
)

export const UserModel = model<User>('User', userSchema)
