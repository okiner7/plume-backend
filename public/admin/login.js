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
    
    if (!response.ok) throw new Error('Invalid token')

    localStorage.setItem('plume_admin_jwt', jwtToken)
    
    // Now fetch the secure core JS, bypass cache just in case
    const coreRes = await fetch(`/api/admin/core.js?_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    })
    
    if (!coreRes.ok) throw new Error('Failed to load secure dashboard logic')
    const coreJs = await coreRes.text()
    
    // Execute the secure script
    try {
      const script = document.createElement('script')
      script.textContent = coreJs
      document.body.appendChild(script)
    } catch (evalErr) {
      console.error("Error executing core.js:", evalErr)
    }

    document.getElementById('auth-view').classList.remove('active')
    document.getElementById('dashboard-view').classList.add('active')
    
    if (typeof initDashboard === 'function') {
      initDashboard()
    } else {
      console.error("initDashboard is not defined! core.js may have failed to execute.")
      alert("Failed to initialize dashboard. Check console for errors. Try hard-refreshing.")
    }
  } catch (err) {
    alert('Authentication failed: ' + err.message)
    localStorage.removeItem('plume_admin_jwt')
    jwtToken = ''
  }
}
