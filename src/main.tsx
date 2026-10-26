import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import App from './App'
import { AppProvider } from './store'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider><App /></AppProvider>
  </React.StrictMode>,
)

// Offline support once installed to the home screen.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}) })
}

// Ask the browser not to evict our data under storage pressure (important on iOS).
navigator.storage?.persist?.().catch(() => {})
