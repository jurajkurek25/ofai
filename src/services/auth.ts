import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/config';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(userId: number, email: string): string {
  return jwt.sign({ userId, email }, config.jwt.secret, { expiresIn: '7d' });
}

export function verifyToken(token: string): { userId: number; email: string } | null {
  try {
    const payload = jwt.verify(token, config.jwt.secret) as { userId: number; email: string };
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}
