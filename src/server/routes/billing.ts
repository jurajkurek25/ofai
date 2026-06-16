import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { jwtAuth } from '../../middleware/jwtAuth';
import {
  createCustomer,
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
  PLANS,
} from '../../services/stripeService';
import { findById, updateStripeCustomerId } from '../../services/userService';

interface CheckoutBody {
  plan: 'creator' | 'pro';
  success_url: string;
  cancel_url: string;
}

interface PortalBody {
  return_url: string;
}

export async function billingRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: jwtAuth };

  // GET /api/billing/plans
  fastify.get('/api/billing/plans', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      plans: [
        {
          id: 'free',
          name: 'Free',
          price: 0,
          currency: 'usd',
          features: [
            '1 AI Persona',
            'Instagram DM automation',
            'Basic conversation history',
            'Manual override messages',
          ],
          limits: { personas: 1, images: 0, contentGen: false },
        },
        {
          id: 'creator',
          name: 'Creator',
          price: 29,
          currency: 'usd',
          priceId: PLANS.creator?.priceId,
          features: [
            '3 AI Personas',
            'Instagram DM automation',
            '50 AI-generated avatars/month',
            'Content generation (posts, reels, stories)',
            'Trend analysis with Grok',
            'Product & shop integration',
          ],
          limits: { personas: 3, images: 50, contentGen: true },
        },
        {
          id: 'pro',
          name: 'Pro',
          price: 79,
          currency: 'usd',
          priceId: PLANS.pro?.priceId,
          features: [
            'Unlimited AI Personas',
            'Instagram DM automation',
            'Unlimited AI-generated avatars',
            'Unlimited content generation',
            'Trend analysis with Grok',
            'Product & shop integration',
            'NSFW content (if enabled)',
            'Priority support',
          ],
          limits: { personas: -1, images: -1, contentGen: true },
        },
      ],
    });
  });

  // POST /api/billing/checkout
  fastify.post<{ Body: CheckoutBody }>(
    '/api/billing/checkout',
    auth,
    async (request: FastifyRequest<{ Body: CheckoutBody }>, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const { plan, success_url, cancel_url } = request.body;

      if (!plan || !success_url || !cancel_url) {
        return reply.code(400).send({ error: 'plan, success_url, and cancel_url are required' });
      }

      if (!['creator', 'pro'].includes(plan)) {
        return reply.code(400).send({ error: 'plan must be creator or pro' });
      }

      const user = findById(userId);
      if (!user) return reply.code(404).send({ error: 'User not found' });

      try {
        let customerId = user.stripe_customer_id;
        if (!customerId) {
          customerId = await createCustomer(user.email, user.name);
          updateStripeCustomerId(userId, customerId);
        }

        const url = await createCheckoutSession(customerId, plan, success_url, cancel_url);
        return reply.send({ url });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Checkout failed';
        return reply.code(500).send({ error: msg });
      }
    }
  );

  // GET /api/billing/portal
  fastify.get<{ Querystring: { return_url?: string } }>(
    '/api/billing/portal',
    auth,
    async (request: FastifyRequest<{ Querystring: { return_url?: string } }>, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const user = findById(userId);
      if (!user) return reply.code(404).send({ error: 'User not found' });

      if (!user.stripe_customer_id) {
        return reply.code(400).send({ error: 'No billing account found. Please subscribe first.' });
      }

      const returnUrl = request.query.return_url ?? 'http://localhost:3000/admin-ui/#billing';

      try {
        const url = await createPortalSession(user.stripe_customer_id, returnUrl);
        return reply.send({ url });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Portal session failed';
        return reply.code(500).send({ error: msg });
      }
    }
  );

  // POST /stripe/webhook (no JWT — verified by Stripe signature)
  fastify.post(
    '/stripe/webhook',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const signature = request.headers['stripe-signature'] as string | undefined;
      const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;

      if (!signature || !rawBody) {
        return reply.code(400).send({ error: 'Missing signature or body' });
      }

      try {
        await handleWebhook(rawBody, signature);
        return reply.send({ received: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Webhook failed';
        return reply.code(400).send({ error: msg });
      }
    }
  );
}
