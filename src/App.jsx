import { useState } from 'react'
import Anthropic from '@anthropic-ai/sdk'
import './App.css'

const client = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_KEY,
  dangerouslyAllowBrowser: true,
})

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

function MealCard({ day, content, isLoading }) {
  const lines = content ? content.split('\n').filter(Boolean) : []

  return (
    <div className={`meal-card ${isLoading ? 'meal-card--loading' : ''}`}>
      <div className="meal-card__header">
        <span className="day-badge">{day}</span>
      </div>
      <div className="meal-card__body">
        {content ? (
          <ul className="meal-list">
            {lines.map((line, i) => {
              const isBold = line.startsWith('Breakfast:') || line.startsWith('Lunch:') || line.startsWith('Dinner:')
              const isCost = line.startsWith('•') || line.startsWith('-') || line.toLowerCase().includes('cost')
              return (
                <li key={i} className={`meal-line ${isBold ? 'meal-line--label' : ''} ${isCost ? 'meal-line--cost' : ''}`}>
                  {line}
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="skeleton">
            <div className="skeleton__line" />
            <div className="skeleton__line skeleton__line--short" />
            <div className="skeleton__line" />
            <div className="skeleton__line skeleton__line--short" />
            <div className="skeleton__line" />
            <div className="skeleton__line skeleton__line--xs" />
          </div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [budget, setBudget] = useState('')
  const [goals, setGoals] = useState('')
  const [pantry, setPantry] = useState('')
  const [mealPlan, setMealPlan] = useState(null)
  const [loading, setLoading] = useState(false)
  const [activeDay, setActiveDay] = useState(-1)
  const [error, setError] = useState('')

  async function handleGenerate() {
    if (!budget.trim() || !goals.trim()) {
      setError('Please enter your weekly budget and dietary goals.')
      return
    }
    setError('')
    setLoading(true)
    setMealPlan(null)
    setActiveDay(0)

    const prompt = `You are a professional nutritionist. Create a practical 5-day meal plan (Monday–Friday) for:

Weekly Budget: $${budget}
Dietary Goals: ${goals}
Pantry Items: ${pantry.trim() || 'None specified'}

Respond ONLY in this exact format — no intro or outro:

**MONDAY**
Breakfast: [brief meal description]
Lunch: [brief meal description]
Dinner: [brief meal description]
• Estimated cost: $[amount]

**TUESDAY**
Breakfast: [brief meal description]
Lunch: [brief meal description]
Dinner: [brief meal description]
• Estimated cost: $[amount]

**WEDNESDAY**
Breakfast: [brief meal description]
Lunch: [brief meal description]
Dinner: [brief meal description]
• Estimated cost: $[amount]

**THURSDAY**
Breakfast: [brief meal description]
Lunch: [brief meal description]
Dinner: [brief meal description]
• Estimated cost: $[amount]

**FRIDAY**
Breakfast: [brief meal description]
Lunch: [brief meal description]
Dinner: [brief meal description]
• Estimated cost: $[amount]

Keep meals practical, budget-friendly, and aligned with the dietary goals. Use pantry items where possible.`

    try {
      let fullText = ''
      const plan = Object.fromEntries(DAYS.map((d) => [d, '']))

      const stream = await client.messages.stream({
        model: 'claude-opus-4-7',
        max_tokens: 2048,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: prompt }],
      })

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          fullText += chunk.delta.text

          // Parse day sections as they stream in
          for (let i = 0; i < DAYS.length; i++) {
            const day = DAYS[i]
            const marker = `**${day.toUpperCase()}**`
            const start = fullText.indexOf(marker)
            if (start === -1) continue

            const nextMarker = DAYS[i + 1] ? `**${DAYS[i + 1].toUpperCase()}**` : null
            const end = nextMarker ? fullText.indexOf(nextMarker) : fullText.length
            const slice = fullText
              .slice(start + marker.length, end === -1 ? fullText.length : end)
              .trim()

            plan[day] = slice
            setActiveDay(i)
          }

          setMealPlan({ ...plan })
        }
      }

      setActiveDay(-1)
    } catch (err) {
      const msg = err?.message ?? String(err)
      setError(
        msg.includes('401') || msg.toLowerCase().includes('api key')
          ? 'Invalid API key — check VITE_ANTHROPIC_KEY in your .env file.'
          : `Error: ${msg}`
      )
    } finally {
      setLoading(false)
    }
  }

  const hasResults = mealPlan && Object.values(mealPlan).some(Boolean)

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__icon">🥗</div>
        <h1 className="app-header__title">Meal Prep Planner</h1>
        <p className="app-header__subtitle">
          AI-powered weekly meal plans tailored to your budget &amp; goals
        </p>
      </header>

      <main className="app-main">
        {/* ── Form ── */}
        <section className="form-section">
          <div className="form-card">
            <div className="form-group">
              <label htmlFor="budget">
                <span className="label-icon">💰</span> Weekly Budget
              </label>
              <div className="input-wrap input-wrap--prefix">
                <span className="input-prefix">$</span>
                <input
                  id="budget"
                  type="number"
                  min="1"
                  placeholder="75"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="goals">
                <span className="label-icon">🎯</span> Dietary Goals
              </label>
              <input
                id="goals"
                type="text"
                placeholder="e.g. high protein, low carb, vegetarian, weight loss…"
                value={goals}
                onChange={(e) => setGoals(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="pantry">
                <span className="label-icon">🧺</span> Pantry Items
                <span className="label-optional"> (optional)</span>
              </label>
              <textarea
                id="pantry"
                placeholder="e.g. rice, canned beans, olive oil, eggs, chicken breast…"
                value={pantry}
                onChange={(e) => setPantry(e.target.value)}
                disabled={loading}
                rows={3}
              />
            </div>

            {error && <p className="error-banner">{error}</p>}

            <button
              className={`generate-btn${loading ? ' generate-btn--loading' : ''}`}
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Generating meal plan…
                </>
              ) : (
                '✨ Generate 5-Day Meal Plan'
              )}
            </button>
          </div>
        </section>

        {/* ── Results ── */}
        {(hasResults || loading) && (
          <section className="results-section">
            <h2 className="results-title">Your 5-Day Meal Plan</h2>
            <div className="cards-grid">
              {DAYS.map((day, i) => (
                <MealCard
                  key={day}
                  day={day}
                  content={mealPlan?.[day] || undefined}
                  isLoading={loading && i <= activeDay && !mealPlan?.[day]}
                />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
