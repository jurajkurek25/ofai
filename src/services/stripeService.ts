import Stripe from 'stripe';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { updatePlan, updateStripeCustomerId, findByEmail } from './userService';
import { db } from '../db/database';

function getStripe(): Stripe {
  if (!config.stripe.secretKey) {
    throw new Error('Stripe secret key not configured');
  }
  return new Stripe(config.stripe.secretKey, { apiVersion: '2024-06-20' });
}

export const PLANS = {
  free: null,
  creator: { priceId: config.stripe.creatorPriceId, amount: 2900, label: 'Creator', currency: 'usd' },
  pro: { priceId: config.stripe.proPriceId, amount: 7900, label: 'Pro', currency: 'usd' },
} as const;

export async function createCustomer(email: string, name: string): Promise<string> {
  const stripe = getStripe();
  const customer = await stripe.customers.create({ email, name });
  return customer.id;
}

export async function createCheckoutSession(
  customerId: string,
  plan: 'creator' | 'pro',
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const stripe = getStripe();
  const planConfig = PLANS[plan];
  if (!planConfig) throw new Error('Invalid plan');

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: planConfig.priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { plan },
  });

  if (!session.url) throw new Error('No checkout URL returned');
  return session.url;
}

export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

export async function handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
  } catch (err) {
    logger.error({ err }, 'Stripe webhook signature verification failed');
    throw new Error('Invalid webhook signature');
  }

  logger.info({ type: event.type }, 'Stripe webhook received');

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const plan = session.metadata?.plan as string | undefined;
      const customerId = session.customer as string;

      if (!plan || !customerId) break;

      const user = db
        .prepare('SELECT * FROM saas_users WHERE stripe_customer_id = ?')
        .get(customerId) as { id: number } | undefined;

      if (user) {
        const expiresAt = Math.floor(Date.now() / 1000) + 30 * 86400;
        updatePlan(user.id, plan, expiresAt);
        logger.info({ userId: user.id, plan }, 'Plan updated via checkout.session.completed');
      }
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      const user = db
        .prepare('SELECT * FROM saas_users WHERE stripe_customer_id = ?')
        .get(customerId) as { id: number } | undefined;

      if (!user) break;

      if (event.type === 'customer.subscription.deleted' || subscription.status === 'canceled') {
        updatePlan(user.id, 'free', null);
        logger.info({ userId: user.id }, 'Plan reverted to free (subscription deleted/canceled)');
      } else if (subscription.status === 'active') {
        const priceId = subscription.items.data[0]?.price.id;
        let plan = 'free';
        if (priceId === config.stripe.creatorPriceId) plan = 'creator';
        else if (priceId === config.stripe.proPriceId) plan = 'pro';

        const expiresAt = subscription.current_period_end;
        updatePlan(user.id, plan, expiresAt);
        logger.info({ userId: user.id, plan }, 'Plan updated via subscription event');
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      const user = db
        .prepare('SELECT * FROM saas_users WHERE stripe_customer_id = ?')
        .get(customerId) as { id: number } | undefined;
      if (user) {
        logger.warn({ userId: user.id }, 'Payment failed for user');
      }
      break;
    }

    default:
      logger.debug({ type: event.type }, 'Unhandled Stripe event');
  }
}
