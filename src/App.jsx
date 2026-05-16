import { useState, useRef } from 'react'
import Anthropic from '@anthropic-ai/sdk'
import './App.css'

const client = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_KEY,
  dangerouslyAllowBrowser: true,
})

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const DEFAULT_PROFILE = { name: '', restrictions: '', cuisines: '' }

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem('mealPrepProfile')) || DEFAULT_PROFILE
  } catch {
    return DEFAULT_PROFILE
  }
}

// Resize image to max 1120px and re-encode as JPEG to stay well under API limits
async function resizeImage(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const MAX = 1120
      let w = img.width, h = img.height
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX }
        else { w = Math.round(w * MAX / h); h = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1])
    }
    img.src = url
  })
}

function ProfilePanel({ profile, onSave, onClose }) {
  const [draft, setDraft] = useState(profile)

  function handleSave() {
    localStorage.setItem('mealPrepProfile', JSON.stringify(draft))
    onSave(draft)
    onClose()
  }

  return (
    <div className="profile-panel">
      <div className="profile-panel__header">
        <h3 className="profile-panel__title">Your Profile</h3>
        <button className="profile-close-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <p className="profile-panel__desc">Save your preferences so you don't have to retype every time.</p>
      <div className="form-group">
        <label htmlFor="prof-name"><span className="label-icon">👤</span> Your Name</label>
        <input id="prof-name" type="text" placeholder="e.g. Alex"
          value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
      </div>
      <div className="form-group">
        <label htmlFor="prof-restrictions"><span className="label-icon">🚫</span> Dietary Restrictions</label>
        <input id="prof-restrictions" type="text" placeholder="e.g. gluten-free, dairy-free, nut allergy"
          value={draft.restrictions} onChange={e => setDraft({ ...draft, restrictions: e.target.value })} />
      </div>
      <div className="form-group">
        <label htmlFor="prof-cuisines"><span className="label-icon">🌍</span> Favorite Cuisines</label>
        <input id="prof-cuisines" type="text" placeholder="e.g. Mediterranean, Asian, Mexican"
          value={draft.cuisines} onChange={e => setDraft({ ...draft, cuisines: e.target.value })} />
      </div>
      <button className="save-profile-btn" onClick={handleSave}>Save Profile</button>
    </div>
  )
}

function MealCard({ day, content, isLoading, isSwapping, isSwapped, anySwapping, swapKey, onSwap, onUndo }) {
  const lines = content ? content.split('\n').filter(Boolean) : []
  const showSkeleton = isSwapping || isLoading || !content

  return (
    <div className={`meal-card${isLoading ? ' meal-card--loading' : ''}${isSwapping ? ' meal-card--swapping' : ''}${isSwapped && !isSwapping ? ' meal-card--swapped' : ''}`}>
      <div className="meal-card__header">
        <div className="meal-card__header-left">
          <span className="day-badge">{day}</span>
          {isSwapped && !isSwapping && <span className="swapped-badge">swapped</span>}
        </div>
        <div className="meal-card__header-right">
          {isSwapped && !isSwapping && (
            <button className="undo-btn" onClick={() => onUndo(day)} title="Undo swap">
              ↩ undo
            </button>
          )}
          {content && !isLoading && (
            <button
              className={`swap-btn${isSwapping ? ' swap-btn--spinning' : ''}`}
              onClick={() => onSwap(day)}
              disabled={anySwapping}
              title="Swap this day's meals"
              aria-label={`Swap meals for ${day}`}
            >
              {isSwapping
                ? <span className="swap-spinner" aria-hidden="true" />
                : '⇄'}
            </button>
          )}
        </div>
      </div>
      <div className="meal-card__body">
        {showSkeleton ? (
          <div className="skeleton">
            <div className="skeleton__line" />
            <div className="skeleton__line skeleton__line--short" />
            <div className="skeleton__line" />
            <div className="skeleton__line skeleton__line--short" />
            <div className="skeleton__line" />
            <div className="skeleton__line skeleton__line--xs" />
          </div>
        ) : (
          <ul key={swapKey} className={`meal-list${isSwapped ? ' meal-list--new' : ''}`}>
            {lines.map((line, i) => {
              const isBold = line.startsWith('Breakfast:') || line.startsWith('Lunch:') || line.startsWith('Dinner:')
              const isCost = line.startsWith('•') || line.startsWith('-') || line.toLowerCase().includes('cost')
              return (
                <li key={i} className={`meal-line${isBold ? ' meal-line--label' : ''}${isCost ? ' meal-line--cost' : ''}`}>
                  {line}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function GrocerySection({ items, newIngredients, onExport }) {
  if (!items.length) return null

  return (
    <section className="grocery-section">
      <div className="grocery-header">
        <h2 className="grocery-title">🛒 Grocery List</h2>
        <button className="export-btn" onClick={onExport}>↓ Export .txt</button>
      </div>
      <ul className="grocery-list">
        {items.map((item, i) => {
          const isNew = newIngredients.has(item.toLowerCase())
          return (
            <li key={i} className={`grocery-item${isNew ? ' grocery-item--new' : ''}`}>
              {isNew && <span className="new-badge">new</span>}
              <span className="grocery-item__name">{item}</span>
              <div className="grocery-item__links">
                <a href={`https://www.walmart.com/search?q=${encodeURIComponent(item)}`}
                  target="_blank" rel="noopener noreferrer" className="shop-link shop-link--walmart">
                  Walmart
                </a>
                <a href={`https://www.amazon.com/s?k=${encodeURIComponent(item)}`}
                  target="_blank" rel="noopener noreferrer" className="shop-link shop-link--amazon">
                  Amazon
                </a>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default function App() {
  const [budget, setBudget] = useState('')
  const [goals, setGoals] = useState(() => {
    const p = loadProfile()
    return [p.restrictions, p.cuisines].filter(Boolean).join(', ')
  })
  const [pantry, setPantry] = useState('')
  const [mealPlan, setMealPlan] = useState(null)
  const [groceryList, setGroceryList] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeDay, setActiveDay] = useState(-1)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState(loadProfile)
  const [showProfile, setShowProfile] = useState(false)

  // Photo scanner
  const fileInputRef = useRef(null)
  const [scanningPhoto, setScanningPhoto] = useState(false)
  const [scanError, setScanError] = useState('')
  const [scannedCount, setScannedCount] = useState(0)

  // Meal swap
  const [swappingDay, setSwappingDay] = useState(null)
  const [swapHistory, setSwapHistory] = useState({})    // { Monday: { original: '...' } }
  const [swappedDays, setSwappedDays] = useState(new Set())
  const [swapKeys, setSwapKeys] = useState({})           // { Monday: number } triggers fade-in
  const [newIngredients, setNewIngredients] = useState(new Set())

  function handleProfileSave(saved) {
    setProfile(saved)
    const parts = [saved.restrictions, saved.cuisines].filter(Boolean)
    if (parts.length) setGoals(parts.join(', '))
  }

  async function handlePhotoScan(e) {
    const files = Array.from(e.target.files)
    if (!files.length) return

    setScanningPhoto(true)
    setScanError('')

    const identified = new Set(
      pantry.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    )

    for (const file of files) {
      try {
        const base64 = await resizeImage(file)

        const response = await client.messages.create({
          model: 'claude-opus-4-7',
          max_tokens: 512,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
              },
              {
                type: 'text',
                text: 'Look at this photo of a pantry, fridge, or kitchen. List every visible food ingredient or grocery item you can identify. Return ONLY a comma-separated list of ingredient names (e.g. "eggs, milk, cheddar cheese, olive oil, chicken breast"). No explanations, no amounts, just the names.',
              },
            ],
          }],
        })

        const text = response.content.find(c => c.type === 'text')?.text ?? ''
        text.split(',').forEach(raw => {
          const item = raw.trim().replace(/[.!?]$/, '').toLowerCase()
          if (item.length > 2) identified.add(item)
        })

        setScannedCount(n => n + 1)
      } catch (err) {
        setScanError(`Scan failed: ${err.message}`)
      }
    }

    setPantry(Array.from(identified).join(', '))
    setScanningPhoto(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSwap(day) {
    if (swappingDay || !mealPlan?.[day]) return

    setSwappingDay(day)

    const prompt = `You are swapping one day's meals in a 5-day meal plan.

Day being swapped: ${day}
Current meals (replace these):
${mealPlan[day]}

Ingredients already in the grocery list (use these first):
${groceryList.length ? groceryList.join(', ') : 'None listed'}

User dietary goals: ${goals}

Provide a meaningfully different replacement — different proteins, cooking methods, or cuisine style. Favor existing grocery list ingredients wherever possible.

Respond ONLY in this exact format, nothing else:
Breakfast: [description]
Lunch: [description]
Dinner: [description]
• Estimated cost: $[amount]

NEW INGREDIENTS NEEDED:
• [simple ingredient name]
(Include the "NEW INGREDIENTS NEEDED:" section only if 1–2 genuinely new items are required. Omit entirely otherwise.)`

    try {
      const response = await client.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 768,
        messages: [{ role: 'user', content: prompt }],
      })

      const text = response.content.find(c => c.type === 'text')?.text?.trim() ?? ''
      const newIngMarker = 'NEW INGREDIENTS NEEDED:'
      const hasNewIng = text.includes(newIngMarker)
      const mealText = hasNewIng
        ? text.slice(0, text.indexOf(newIngMarker)).trim()
        : text

      if (hasNewIng) {
        const ingSection = text.slice(text.indexOf(newIngMarker) + newIngMarker.length)
        const additions = ingSection
          .split('\n')
          .filter(l => /^[•\-\*]/.test(l.trim()))
          .map(l => l.replace(/^[•\-\*]\s*/, '').trim().toLowerCase())
          .filter(Boolean)

        if (additions.length) {
          setNewIngredients(prev => new Set([...prev, ...additions]))
          setGroceryList(prev => {
            const existing = new Set(prev.map(i => i.toLowerCase()))
            const toAdd = additions.filter(i => !existing.has(i))
            return toAdd.length ? [...prev, ...toAdd] : prev
          })
        }
      }

      const newSwapKey = Date.now()
      setSwapHistory(prev => ({ ...prev, [day]: { original: mealPlan[day] } }))
      setMealPlan(prev => ({ ...prev, [day]: mealText }))
      setSwappedDays(prev => new Set([...prev, day]))
      setSwapKeys(prev => ({ ...prev, [day]: newSwapKey }))
    } catch {
      // card gracefully falls back to original content when swappingDay clears
    } finally {
      setSwappingDay(null)
    }
  }

  function handleUndo(day) {
    if (!swapHistory[day]) return
    setMealPlan(prev => ({ ...prev, [day]: swapHistory[day].original }))
    setSwapHistory(prev => { const n = { ...prev }; delete n[day]; return n })
    setSwappedDays(prev => { const n = new Set(prev); n.delete(day); return n })
    setSwapKeys(prev => ({ ...prev, [day]: 0 }))
  }

  function exportGroceryList() {
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const text = [
      'MEAL PREP GROCERY LIST',
      '======================',
      `Week of: ${dateStr}`,
      '',
      ...groceryList.map(item =>
        `☐  ${item}${newIngredients.has(item.toLowerCase()) ? '  ← new' : ''}`
      ),
      '',
      '─'.repeat(26),
      'Generated by Meal Prep Planner',
    ].join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'grocery-list.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleGenerate() {
    if (!budget.trim() || !goals.trim()) {
      setError('Please enter your weekly budget and dietary goals.')
      return
    }
    setError('')
    setLoading(true)
    setMealPlan(null)
    setGroceryList([])
    setActiveDay(0)
    setSwapHistory({})
    setSwappedDays(new Set())
    setSwapKeys({})
    setNewIngredients(new Set())

    const forName = profile.name ? `for ${profile.name} ` : ''

    const prompt = `You are a professional nutritionist. Create a practical 5-day meal plan (Monday–Friday) ${forName}for:

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

**GROCERY LIST**
• [ingredient]
• [ingredient]
(List every unique ingredient needed across all 5 days. Simple grocery names only — no amounts, no prep notes, no duplicates.)

Keep meals practical, budget-friendly, and aligned with the dietary goals. Use pantry items where possible.`

    try {
      let fullText = ''
      const plan = Object.fromEntries(DAYS.map((d) => [d, '']))

      const stream = await client.messages.stream({
        model: 'claude-opus-4-7',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: prompt }],
      })

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          fullText += chunk.delta.text

          for (let i = 0; i < DAYS.length; i++) {
            const day = DAYS[i]
            const marker = `**${day.toUpperCase()}**`
            const start = fullText.indexOf(marker)
            if (start === -1) continue

            const nextMarker = DAYS[i + 1]
              ? `**${DAYS[i + 1].toUpperCase()}**`
              : '**GROCERY LIST**'
            const end = fullText.indexOf(nextMarker, start + marker.length)
            const slice = fullText
              .slice(start + marker.length, end === -1 ? fullText.length : end)
              .trim()

            plan[day] = slice
            setActiveDay(i)
          }

          setMealPlan({ ...plan })

          const gMarker = '**GROCERY LIST**'
          const gStart = fullText.indexOf(gMarker)
          if (gStart !== -1) {
            const gSection = fullText.slice(gStart + gMarker.length).trim()
            const items = gSection
              .split('\n')
              .filter(line => /^[•\-\*]/.test(line.trim()))
              .map(line => line.replace(/^[•\-\*]\s*/, '').trim())
              .filter(Boolean)
            setGroceryList(items)
          }
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
        <div className="app-header__top">
          <div className="app-header__brand">
            <div className="app-header__icon">🥗</div>
            <div>
              <h1 className="app-header__title">Meal Prep Planner</h1>
              <p className="app-header__subtitle">
                AI-powered weekly meal plans tailored to your budget &amp; goals
              </p>
            </div>
          </div>
          <button
            className={`profile-toggle-btn${showProfile ? ' profile-toggle-btn--active' : ''}`}
            onClick={() => setShowProfile(v => !v)}
          >
            👤 {profile.name || 'My Profile'}
          </button>
        </div>
      </header>

      <main className="app-main">
        {showProfile && (
          <ProfilePanel
            profile={profile}
            onSave={handleProfileSave}
            onClose={() => setShowProfile(false)}
          />
        )}

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
                  onChange={e => setBudget(e.target.value)}
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
                onChange={e => setGoals(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <div className="pantry-label-row">
                <label htmlFor="pantry">
                  <span className="label-icon">🧺</span> Pantry Items
                  <span className="label-optional"> (optional)</span>
                </label>
                <button
                  type="button"
                  className={`scan-btn${scanningPhoto ? ' scan-btn--loading' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={scanningPhoto || loading}
                  title="Take a photo or upload an image of your pantry or fridge"
                >
                  {scanningPhoto
                    ? <><span className="scan-spinner" aria-hidden="true" /> Scanning…</>
                    : <>📷 Scan Photo</>}
                </button>
              </div>
              {scannedCount > 0 && !scanningPhoto && (
                <p className="scan-success">
                  ✓ {scannedCount} photo{scannedCount !== 1 ? 's' : ''} scanned — ingredients added below
                </p>
              )}
              {scanError && <p className="scan-error">{scanError}</p>}
              <textarea
                id="pantry"
                placeholder="e.g. rice, canned beans, olive oil, eggs, chicken breast… (or scan a photo above)"
                value={pantry}
                onChange={e => setPantry(e.target.value)}
                disabled={loading}
                rows={3}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handlePhotoScan}
              />
            </div>

            {error && <p className="error-banner">{error}</p>}

            <button
              className={`generate-btn${loading ? ' generate-btn--loading' : ''}`}
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading
                ? <><span className="spinner" aria-hidden="true" /> Generating meal plan…</>
                : '✨ Generate 5-Day Meal Plan'}
            </button>
          </div>
        </section>

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
                  isSwapping={swappingDay === day}
                  isSwapped={swappedDays.has(day)}
                  anySwapping={!!swappingDay}
                  swapKey={swapKeys[day] ?? 0}
                  onSwap={handleSwap}
                  onUndo={handleUndo}
                />
              ))}
            </div>
          </section>
        )}

        {!loading && groceryList.length > 0 && (
          <GrocerySection
            items={groceryList}
            newIngredients={newIngredients}
            onExport={exportGroceryList}
          />
        )}
      </main>
    </div>
  )
}
