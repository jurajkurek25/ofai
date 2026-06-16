import { db } from '../db/database';

export interface Persona {
  id: number;
  user_id: number;
  name: string;
  age: number;
  nationality: string;
  bio: string;
  personality: string;
  tone: string;
  avatar_prompt: string;
  is_active: number;
  is_nsfw_enabled: number;
  created_at: number;
}

export interface Product {
  id: number;
  persona_id: number;
  user_id: number;
  name: string;
  description: string;
  price: number;
  currency: string;
  type: string;
  is_active: number;
}

export interface PersonaData {
  name?: string;
  age?: number;
  nationality?: string;
  bio?: string;
  personality?: string;
  tone?: string;
  avatar_prompt?: string;
  is_active?: number;
  is_nsfw_enabled?: number;
}

export interface ProductData {
  name: string;
  description?: string;
  price: number;
  currency?: string;
  type?: string;
  is_active?: number;
}

export function createPersona(userId: number, data: PersonaData): Persona {
  const result = db
    .prepare(
      `INSERT INTO personas (user_id, name, age, nationality, bio, personality, tone, avatar_prompt, is_nsfw_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      data.name ?? 'New Persona',
      data.age ?? 22,
      data.nationality ?? 'European',
      data.bio ?? '',
      data.personality ?? '',
      data.tone ?? '',
      data.avatar_prompt ?? '',
      data.is_nsfw_enabled ?? 0
    );

  return db
    .prepare('SELECT * FROM personas WHERE id = ?')
    .get(result.lastInsertRowid as number) as Persona;
}

export function updatePersona(id: number, userId: number, data: PersonaData): Persona {
  const persona = getPersona(id, userId);
  if (!persona) throw new Error('Persona not found');

  db.prepare(
    `UPDATE personas SET
      name = ?, age = ?, nationality = ?, bio = ?, personality = ?,
      tone = ?, avatar_prompt = ?, is_active = ?, is_nsfw_enabled = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    data.name ?? persona.name,
    data.age ?? persona.age,
    data.nationality ?? persona.nationality,
    data.bio ?? persona.bio,
    data.personality ?? persona.personality,
    data.tone ?? persona.tone,
    data.avatar_prompt ?? persona.avatar_prompt,
    data.is_active ?? persona.is_active,
    data.is_nsfw_enabled ?? persona.is_nsfw_enabled,
    id,
    userId
  );

  return db.prepare('SELECT * FROM personas WHERE id = ?').get(id) as Persona;
}

export function deletePersona(id: number, userId: number): void {
  const result = db.prepare('DELETE FROM personas WHERE id = ? AND user_id = ?').run(id, userId);
  if (result.changes === 0) throw new Error('Persona not found');
}

export function getPersonas(userId: number): Persona[] {
  return db.prepare('SELECT * FROM personas WHERE user_id = ? ORDER BY created_at ASC').all(userId) as Persona[];
}

export function getPersona(id: number, userId: number): Persona | undefined {
  return db.prepare('SELECT * FROM personas WHERE id = ? AND user_id = ?').get(id, userId) as Persona | undefined;
}

export function getPersonaById(id: number): Persona | undefined {
  return db.prepare('SELECT * FROM personas WHERE id = ?').get(id) as Persona | undefined;
}

export function addProduct(personaId: number, userId: number, data: ProductData): Product {
  const persona = db.prepare('SELECT id FROM personas WHERE id = ? AND user_id = ?').get(personaId, userId);
  if (!persona) throw new Error('Persona not found');

  const result = db
    .prepare(
      `INSERT INTO products (persona_id, user_id, name, description, price, currency, type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      personaId,
      userId,
      data.name,
      data.description ?? '',
      data.price,
      data.currency ?? 'USD',
      data.type ?? 'photo_pack'
    );

  return db
    .prepare('SELECT * FROM products WHERE id = ?')
    .get(result.lastInsertRowid as number) as Product;
}

export function updateProduct(
  id: number,
  personaId: number,
  userId: number,
  data: Partial<ProductData>
): Product {
  const product = db
    .prepare('SELECT * FROM products WHERE id = ? AND persona_id = ? AND user_id = ?')
    .get(id, personaId, userId) as Product | undefined;

  if (!product) throw new Error('Product not found');

  db.prepare(
    `UPDATE products SET name = ?, description = ?, price = ?, currency = ?, type = ?, is_active = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    data.name ?? product.name,
    data.description ?? product.description,
    data.price ?? product.price,
    data.currency ?? product.currency,
    data.type ?? product.type,
    data.is_active ?? product.is_active,
    id,
    userId
  );

  return db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product;
}

export function deleteProduct(id: number, userId: number): void {
  const result = db.prepare('DELETE FROM products WHERE id = ? AND user_id = ?').run(id, userId);
  if (result.changes === 0) throw new Error('Product not found');
}

export function getProducts(personaId: number, userId: number): Product[] {
  return db
    .prepare('SELECT * FROM products WHERE persona_id = ? AND user_id = ? ORDER BY id ASC')
    .all(personaId, userId) as Product[];
}

export function getProductsByPersonaId(personaId: number): Product[] {
  return db
    .prepare('SELECT * FROM products WHERE persona_id = ? AND is_active = 1')
    .all(personaId) as Product[];
}

export function buildSystemPrompt(persona: Persona, products: Product[]): string {
  const productList = products
    .filter((p) => p.is_active)
    .map(
      (p) =>
        `- ${p.name}: ${p.description || 'No description'} — $${p.price} ${p.currency} (${p.type})`
    )
    .join('\n');

  return `You are ${persona.name}, a ${persona.age}-year-old ${persona.nationality} content creator.

Bio: ${persona.bio || 'A passionate content creator with a unique style.'}

Personality: ${persona.personality || 'Friendly, engaging, and authentic.'}

Tone: ${persona.tone || 'Casual and warm.'}

${
  productList
    ? `You have the following products/services to promote when relevant:\n${productList}\n\nNaturally mention these when the conversation is appropriate — never be pushy, but always be aware of opportunities to share your offers.`
    : ''
}

Always stay in character. Keep replies concise (1-3 sentences max). Be engaging, authentic, and true to your personality. Never break character or reveal you are an AI. If someone asks something inappropriate, deflect gracefully and redirect to your content.`;
}
