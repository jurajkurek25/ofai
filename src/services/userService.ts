import { db } from '../db/database';
import { hashPassword } from './auth';

export interface SaasUser {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  stripe_customer_id: string | null;
  plan: 'free' | 'creator' | 'pro';
  plan_expires_at: number | null;
  created_at: number;
  is_active: number;
}

export interface PlanLimits {
  maxPersonas: number;
  monthlyImages: number;
  contentGen: boolean;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: { maxPersonas: 1, monthlyImages: 0, contentGen: false },
  creator: { maxPersonas: 3, monthlyImages: 50, contentGen: true },
  pro: { maxPersonas: Infinity, monthlyImages: Infinity, contentGen: true },
};

export async function createUser(email: string, password: string, name: string): Promise<SaasUser> {
  const existing = findByEmail(email);
  if (existing) throw new Error('Email already registered');

  const passwordHash = await hashPassword(password);
  const result = db
    .prepare('INSERT INTO saas_users (email, password_hash, name) VALUES (?, ?, ?)')
    .run(email, passwordHash, name);

  return findById(result.lastInsertRowid as number) as SaasUser;
}

export function findByEmail(email: string): SaasUser | undefined {
  return db.prepare('SELECT * FROM saas_users WHERE email = ?').get(email) as SaasUser | undefined;
}

export function findById(id: number): SaasUser | undefined {
  return db.prepare('SELECT * FROM saas_users WHERE id = ?').get(id) as SaasUser | undefined;
}

export function updatePlan(userId: number, plan: string, expiresAt: number | null): void {
  db.prepare('UPDATE saas_users SET plan = ?, plan_expires_at = ? WHERE id = ?').run(
    plan,
    expiresAt,
    userId
  );
}

export function updateStripeCustomerId(userId: number, customerId: string): void {
  db.prepare('UPDATE saas_users SET stripe_customer_id = ? WHERE id = ?').run(customerId, userId);
}

export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}
