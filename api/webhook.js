import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Webhook needs the service role key (not anon) to bypass RLS
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Vercel: disable body parsing so we can verify the Stripe signature
export const config = { api: { bodyParser: false } }

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const rawBody = await getRawBody(req)
  const sig = req.headers['stripe-signature']

  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Webhook signature error:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const userId = session.metadata?.userId
    const email = session.customer_email || session.metadata?.email

    if (userId) {
      const { error } = await supabase
        .from('users')
        .update({ tier: 'pro' })
        .eq('id', userId)

      if (error) console.error('Supabase update error:', error)
    } else if (email) {
      // Fallback if userId wasn't passed
      const { error } = await supabase
        .from('users')
        .update({ tier: 'pro' })
        .eq('email', email)

      if (error) console.error('Supabase update by email error:', error)
    }
  }

  res.status(200).json({ received: true })
}
