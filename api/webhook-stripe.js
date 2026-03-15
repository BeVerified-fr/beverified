import { Redis } from '@upstash/redis';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Durées en jours selon le produit
const DURATIONS = {
  'price_1TBKu1Fvf7qAakW8zn9MqNmU': 30,   // 1 mois
  'price_1TBKuYFvf7qAakW83B0fnOsW': 90,   // 3 mois
  'price_1TBKuuFvf7qAakW8M7HriLww': 180,  // 6 mois
};

function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return res.status(400).json({ error: 'Webhook signature invalide: ' + err.message });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email || session.customer_email;
    const priceId = session.line_items?.data?.[0]?.price?.id;

    // Récupère les line items si pas disponibles
    let resolvedPriceId = priceId;
    if (!resolvedPriceId) {
      try {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        resolvedPriceId = lineItems.data[0]?.price?.id;
      } catch(e) {}
    }

    const days = DURATIONS[resolvedPriceId] || 30;
    const token = generateToken();
    const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;

    // Stocke le token dans Upstash
    await redis.set(`token:${token}`, JSON.stringify({
      email,
      priceId: resolvedPriceId,
      days,
      expiresAt,
      createdAt: Date.now(),
    }), { exUntil: expiresAt });

    // Envoie l'email via Brevo
    await sendAccessEmail(email, token, days);
  }

  return res.status(200).json({ received: true });
}

async function sendAccessEmail(email, token, days) {
  const accessUrl = `https://beverified.fr/acces?token=${token}`;
  const offerLabel = days === 30 ? 'Essential — 1 mois' : days === 90 ? 'Pro — 3 mois' : 'Elite — 6 mois';

  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: 'BeVerified', email: 'hello@beverified.fr' },
      to: [{ email }],
      subject: 'Votre accès BeVerified est prêt ✓',
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#F2EEE8;padding:40px 32px;border-radius:16px">
          <div style="text-align:center;margin-bottom:32px">
            <span style="font-size:22px;font-weight:900;color:#16120E">Be</span><span style="font-size:22px;font-weight:900;color:#E8412A">Verified</span>
          </div>
          <h2 style="font-size:22px;font-weight:900;color:#16120E;margin-bottom:12px">Votre accès est activé</h2>
          <p style="font-size:14px;color:#7A6F65;line-height:1.7;margin-bottom:8px">Offre souscrite : <strong style="color:#16120E">${offerLabel}</strong></p>
          <p style="font-size:14px;color:#7A6F65;line-height:1.7;margin-bottom:32px">Votre accès est valable <strong style="color:#16120E">${days} jours</strong> à partir d'aujourd'hui.</p>
          <div style="text-align:center;margin-bottom:32px">
            <a href="${accessUrl}" style="background:#E8412A;color:white;padding:16px 36px;border-radius:100px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block">
              Accéder à BeVerified →
            </a>
          </div>
          <p style="font-size:12px;color:#A89F96;line-height:1.6;text-align:center">Ce lien est personnel et sécurisé. Ne le partagez pas.<br>Une question ? <a href="mailto:hello@beverified.fr" style="color:#E8412A">hello@beverified.fr</a></p>
        </div>
      `
    })
  });
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export const config = { api: { bodyParser: false } };
