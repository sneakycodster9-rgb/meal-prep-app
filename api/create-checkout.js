import Stripe from 'stripe'

const PRICE_ID = 'price_1Tbmfb2KivRS925TFrkDXZQ1'

export default async function handler(req, res) {
  console.log('Stripe key exists:', !!process.env.STRIPE_SECRET_KEY)
  console.log('Price ID:', process.env.STRIPE_PRICE_ID)

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const { email, userId } = req.body

    if (!email) {
      return res.status(400).json({ error: 'Email is required' })
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      mode: 'subscription',
      success_url: `${req.headers.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: req.headers.origin,
      metadata: { userId: userId || '', email },
    })

    res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('Stripe checkout error:', err)
    res.status(500).json({ error: err.message, type: err.type, code: err.code })
  }
}
