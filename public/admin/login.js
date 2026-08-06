let jwtToken = localStorage.getItem('plume_admin_jwt') || ''

document.addEventListener('DOMContentLoaded', () => {
  const jwtInput = document.getElementById('jwtToken')
  if (jwtInput) {
    jwtInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') login()
    })
  }

  document.getElementById('btn-login')?.addEventListener('click', login)

  if (jwtToken) {
    document.getElementById('jwtToken').value = jwtToken
    login()
  }
})

async function login() {
  const tokenInputRaw = document.getElementById('jwtToken').value;
  const tokenMatch = tokenInputRaw.match(/[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/);
  const tokenInput = tokenMatch ? tokenMatch[0] : tokenInputRaw.trim();

  if (!tokenInput) {
    alert('Please enter a valid JWT token')
    return
  }
  
  if (/[^\x20-\x7E]/.test(tokenInput)) {
    alert('Invalid characters in token.')
    return
  }

  jwtToken = tokenInput
  
  try {
    const response = await fetch('/api/status', {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    })
    
    if (!response.ok) {
      let errStr = 'Invalid token'
      try {
        const body = await response.json()
        errStr = body.error || errStr
      } catch (e) {
        errStr = `HTTP Error ${response.status}`
      }
      throw new Error(errStr)
    }

    localStorage.setItem('plume_admin_jwt', jwtToken)
    
    // Now fetch the secure core JS, bypass cache just in case
    const coreRes = await fetch(`/api/admin/core.js?_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    })
    
    if (!coreRes.ok) throw new Error('Failed to load secure dashboard logic')
    const coreJs = await coreRes.text()
    
    // Remove old script tag if exists
    const oldScript = document.getElementById('injected-core-script')
    if (oldScript) oldScript.remove()

    const script = document.createElement('script')
    script.id = 'injected-core-script'
    script.type = 'text/javascript'
    script.text = coreJs
    document.head.appendChild(script)

    // Force global window evaluation to guarantee scope availability
    try {
      window.eval(coreJs)
    } catch (evalErr) {
      console.error("Error evaluating core.js:", evalErr)
    }

    document.getElementById('auth-view').classList.remove('active')
    document.getElementById('dashboard-view').classList.add('active')
    
    if (typeof window.initDashboard === 'function') {
      window.initDashboard()
    } else if (typeof initDashboard === 'function') {
      initDashboard()
    } else {
      console.error("initDashboard is not defined! core.js may have failed to execute.")
      alert("Failed to initialize dashboard. Try hard-refreshing (Ctrl+F5).")
    }
  } catch (err) {
    alert('Authentication failed: ' + err.message)
    localStorage.removeItem('plume_admin_jwt')
    jwtToken = ''
  }
}
