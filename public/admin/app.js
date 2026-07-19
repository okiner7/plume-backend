let jwtToken = localStorage.getItem('lunex_admin_jwt') || ''
let chartInstance = null
let logsInterval = null

document.addEventListener('DOMContentLoaded', () => {
  const jwtInput = document.getElementById('jwtToken')
  if (jwtInput) {
    jwtInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') login()
    })
  }

  document.getElementById('btn-login')?.addEventListener('click', login)
  document.getElementById('btn-logout')?.addEventListener('click', logout)
  document.getElementById('btn-refresh-stats')?.addEventListener('click', fetchStats)
  document.getElementById('btn-refresh-users')?.addEventListener('click', fetchRecentUsers)
  document.getElementById('btn-refresh-proxies')?.addEventListener('click', fetchProxies)
  document.getElementById('btn-reset-proxies')?.addEventListener('click', resetProxies)
  document.getElementById('btn-add-proxy')?.addEventListener('click', addProxy)
  document.getElementById('btn-refresh-insights')?.addEventListener('click', fetchInsights)
  document.getElementById('btn-close-user-modal')?.addEventListener('click', () => document.getElementById('user-modal').classList.remove('active'))
  document.getElementById('btn-flush-cache')?.addEventListener('click', flushCache)
  document.getElementById('btn-restart-server')?.addEventListener('click', restartServer)
  
  const searchInput = document.getElementById('user-search')
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      filterUsers(searchInput.value)
    })
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabId = e.currentTarget.getAttribute('data-tab')
      if (tabId) switchTab(tabId)
    })
  })

  if (jwtToken) {
    document.getElementById('jwtToken').value = jwtToken
    login()
  }
})

async function apiRequest(endpoint, method = 'GET', body = null) {
  if (!jwtToken) throw new Error('Not authenticated')
  
  const headers = {
    'Authorization': `Bearer ${jwtToken}`,
    'Content-Type': 'application/json'
  }
  
  const url = endpoint.startsWith('/api/') ? endpoint : `/api/admin${endpoint}`
  
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  })
  
  const data = await response.json()
  
  if (!response.ok || data.success === false) {
    if (response.status === 401 || response.status === 403) logout()
    throw new Error(data.error || 'API Error')
  }
  
  return data.data !== undefined ? data.data : data
}

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
    await apiRequest('/api/status')
    localStorage.setItem('lunex_admin_jwt', jwtToken)
    document.getElementById('auth-view').classList.remove('active')
    document.getElementById('dashboard-view').classList.add('active')
    switchTab('overview')
  } catch (err) {
    alert('Authentication failed: ' + err.message)
    localStorage.removeItem('lunex_admin_jwt')
    jwtToken = ''
  }
}

function logout() {
  localStorage.removeItem('lunex_admin_jwt')
  jwtToken = ''
  document.getElementById('jwtToken').value = ''
  document.getElementById('dashboard-view').classList.remove('active')
  document.getElementById('auth-view').classList.add('active')
  if (logsInterval) clearInterval(logsInterval)
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'))
  const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('data-tab') === tabId)
  if (activeBtn) activeBtn.classList.add('active')
  
  document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'))
  const pane = document.getElementById(`tab-${tabId}`)
  if (pane) pane.classList.add('active')
  
  if (logsInterval) clearInterval(logsInterval)

  if (tabId === 'overview') fetchStats()
  else if (tabId === 'users') fetchRecentUsers()
  else if (tabId === 'proxies') fetchProxies()
  else if (tabId === 'insights') fetchInsights()
  else if (tabId === 'logs') {
    fetchLogs()
    logsInterval = setInterval(fetchLogs, 2000)
  }
}

async function fetchStats() {
  try {
    const res = await apiRequest('/api/status')
    const data = res.data || res || {}
    let totalUsers = 0, activeUsers24h = 0;
    if (data.stats?.totalUsers) totalUsers = Object.values(data.stats.totalUsers).reduce((a, b) => a + b, 0)
    else if (typeof data.stats?.totalUsers === 'number') totalUsers = data.stats.totalUsers
    
    if (data.stats?.activeUsersToday) activeUsers24h = Object.values(data.stats.activeUsersToday).reduce((a, b) => a + b, 0)
    else if (typeof data.stats?.activeUsersToday === 'number') activeUsers24h = data.stats.activeUsersToday

    document.getElementById('stat-active-users').innerText = activeUsers24h
    document.getElementById('stat-total-users').innerText = totalUsers
    
    if (data.memory) {
      document.getElementById('stat-memory').innerText = data.memory.appMemoryMB + ' MB'
    }
    const uptime = data.uptimeSeconds || 0
    const hrs = Math.floor(uptime / 3600)
    const mins = Math.floor((uptime % 3600) / 60)
    document.getElementById('stat-uptime').innerText = `${hrs}h ${mins}m`

    const historyRes = await apiRequest('/metrics/history')
    const history = historyRes.data || historyRes || []
    updateChart(history)
  } catch (err) {
    console.error('Failed to load stats', err)
  }
}

function updateChart(history) {
  const ctx = document.getElementById('metricsChart').getContext('2d')
  
  const labels = history.map(h => h.time)
  const ramData = history.map(h => h.ram)
  const usersData = history.map(h => h.users)

  if (chartInstance) chartInstance.destroy()

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'RAM (MB)',
          data: ramData,
          borderColor: '#ffffff',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          tension: 0,
          fill: true
        },
        {
          label: 'Active Users',
          data: usersData,
          borderColor: '#888888',
          backgroundColor: 'transparent',
          borderDash: [5, 5],
          tension: 0,
          fill: false,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      color: '#ededed',
      scales: {
        x: { grid: { color: '#222222' }, ticks: { color: '#888888' } },
        y: { grid: { color: '#222222' }, ticks: { color: '#888888' } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#888888' } }
      },
      plugins: {
        legend: { labels: { color: '#ededed' } }
      }
    }
  })
}

async function fetchProxies() {
  try {
    const res = await apiRequest('/proxies')
    const proxies = Array.isArray(res) ? res : (res.data || [])
    const tbody = document.getElementById('proxy-tbody')
    tbody.innerHTML = ''
    
    if (proxies.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted)">No proxies configured</td></tr>'
      return
    }
    
    proxies.forEach(p => {
      const isCooldown = p.status.startsWith('cooldown')
      const isOffline = p.status === 'offline'
      let statusHtml = ''
      if (isOffline) {
        statusHtml = `<span class="badge" style="background: var(--surface-light); color: var(--text-muted); border: 1px solid var(--border); padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">OFFLINE</span>`
      } else if (isCooldown) {
        statusHtml = `<span class="badge danger" style="background: var(--danger-bg); color: var(--danger); border: 1px solid rgba(255, 69, 58, 0.3); padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">${p.status.toUpperCase()}</span>` 
      } else {
        statusHtml = `<span class="badge success" style="background: rgba(50, 215, 75, 0.1); color: var(--success); border: 1px solid rgba(50, 215, 75, 0.3); padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">ACTIVE</span>`
      }
      
      const actionHtml = `<button class="btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="removeProxy('${p._url || p.url}')">Remove</button>`
      const displayIp = (p.address || p.url || 'Unknown').replace(/.*@/, '')

      tbody.innerHTML += `
        <tr>
          <td style="font-family: monospace">${displayIp} <span class="badge gray" style="margin-left: 8px">${p.country || 'XX'}</span></td>
          <td>${statusHtml}</td>
          <td>${p.fails || p.failCount || 0}</td>
          <td>${actionHtml}</td>
        </tr>
      `
    })
  } catch (err) {
    console.error('Failed to load proxies', err)
  }
}

async function resetProxies() {
  try {
    const data = await apiRequest('/proxies/reset', 'POST')
    alert(data.message)
    fetchProxies()
  } catch (err) {
    alert('Failed to reset proxies: ' + err.message)
  }
}

async function addProxy() {
  const url = document.getElementById('proxy-input').value.trim()
  if (!url) return alert('Enter proxy URL')
  try {
    const data = await apiRequest('/proxies', 'POST', { url })
    alert(data.message)
    document.getElementById('proxy-input').value = ''
    fetchProxies()
  } catch (err) {
    alert('Failed to add: ' + err.message)
  }
}

async function removeProxy(url) {
  if (!confirm('Remove this proxy?')) return
  try {
    const data = await apiRequest('/proxies', 'DELETE', { url })
    alert(data.message)
    fetchProxies()
  } catch (err) {
    alert('Failed to remove: ' + err.message)
  }
}

let allUsers = []

async function fetchRecentUsers() {
  try {
    const res = await apiRequest('/users/recent')
    allUsers = res.data || res || []
    filterUsers(document.getElementById('user-search').value)
  } catch (err) {
    console.error('Failed to load recent users', err)
  }
}

function filterUsers(query) {
  const tbody = document.getElementById('users-tbody')
  tbody.innerHTML = ''
  
  const q = (query || '').toLowerCase()
  const filtered = allUsers.filter(u => 
    (u.name || '').toLowerCase().includes(q) || 
    (u.id || '').toLowerCase().includes(q)
  )

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted)">No users found</td></tr>'
    return
  }
  
  filtered.forEach(u => {
    let platHtml = ''
    if (u.platform === 'android') platHtml = '<span class="plat-icon">📱</span> Android'
    else if (u.platform === 'windows') platHtml = '<span class="plat-icon">💻</span> Windows'
    else if (u.platform === 'linux') platHtml = '<span class="plat-icon">🐧</span> Linux'
    else platHtml = '<span class="plat-icon">❓</span> Unknown'

    const dateStr = new Date(u.lastActiveAt).toLocaleString()
    const statusHtml = u.banned ? '<span class="status-banned">Banned</span>' : '<span class="status-active">Active</span>'
    const actionBtn = u.banned 
      ? `<button class="btn-glass" onclick="unbanUser('${u.id}')">Unban</button>`
      : `<button class="btn-danger" onclick="banUser('${u.id}')">Ban</button>`
    const detailsBtn = `<button class="btn-secondary" onclick="openUserModal('${u.id}')">Details</button>`
    
    tbody.innerHTML += `
      <tr>
        <td>${platHtml}</td>
        <td style="font-family: monospace; color: var(--neon-blue); cursor: pointer;" onclick="openUserModal('${u.id}')">${u.id}</td>
        <td>${u.name}</td>
        <td style="color: var(--text-muted)">${dateStr}</td>
        <td>${statusHtml}</td>
        <td style="display: flex; gap: 8px;">${detailsBtn}${actionBtn}</td>
      </tr>
    `
  })
}

async function openUserModal(id) {
  try {
    const res = await apiRequest(`/users/${id}/details`)
    const data = res.data || res
    
    const user = data.user || { id, name: id }
    document.getElementById('up-name').innerText = user.name || id
    
    if (user.avatar) {
      document.getElementById('up-avatar').innerHTML = `<img src="${user.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`
    } else {
      document.getElementById('up-avatar').innerText = (user.name || id).substring(0, 1).toUpperCase()
    }
    
    // Setup badges
    let badgesHtml = `<span class="badge gray">${user.id || user.providerId || id}</span>`
    if (user.platform) badgesHtml += `<span class="badge" style="background: rgba(255,255,255,0.1)">${user.platform}</span>`
    if (user.badges && Array.isArray(user.badges)) {
      user.badges.forEach(b => {
        const text = typeof b === 'string' ? b.toUpperCase() : (b.label ? b.label.toUpperCase() : 'BADGE')
        badgesHtml += `<span class="badge" style="background: linear-gradient(45deg, #f39c12, #d35400); color: white; border: none; font-weight: bold;">${text}</span>`
      })
    }
    if (user.banned) badgesHtml += `<span class="badge danger">BANNED</span>`
    else badgesHtml += `<span class="badge success">ACTIVE</span>`
    document.getElementById('up-badges').innerHTML = badgesHtml

    // Setup actions
    if (user.banned) {
      document.getElementById('up-actions').innerHTML = `<button class="btn-glass" onclick="unbanUser('${user.id}'); closeUserModal()">Unban User</button>`
    } else {
      document.getElementById('up-actions').innerHTML = `<button class="btn-danger" onclick="banUser('${user.id}'); closeUserModal()">Ban User</button>`
    }

    // Stats
    const totalSearches = (data.searchHistory && data.searchHistory.length) || 0
    const totalListens = (data.listeningHistory && data.listeningHistory.length) || 0
    document.getElementById('up-stat-searches').innerText = totalSearches
    document.getElementById('up-stat-listens').innerText = totalListens
    document.getElementById('up-stat-playlists').innerText = (data.playlists && data.playlists.length) || 0
    document.getElementById('up-stat-active').innerText = user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleString() : '-'

    const searchTbody = document.getElementById('user-modal-searches')
    searchTbody.innerHTML = ''
    if (data.searchHistory && data.searchHistory.length) {
      data.searchHistory.slice(0, 20).forEach(s => {
        searchTbody.innerHTML += `
          <div class="feed-item">
            <div class="feed-title">${s.query}</div>
            <div class="feed-date">${new Date(s.createdAt).toLocaleDateString()}</div>
          </div>
        `
      })
    } else {
      searchTbody.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding: 12px; font-size: 13px;">No recent searches</div>'
    }
    
    const listenTbody = document.getElementById('user-modal-listens')
    listenTbody.innerHTML = ''
    if (data.listeningHistory && data.listeningHistory.length) {
      data.listeningHistory.slice(0, 20).forEach(s => {
        listenTbody.innerHTML += `
          <div class="feed-item">
            <div class="feed-title">${s.title}</div>
            <div class="feed-date">${new Date(s.playedAt).toLocaleDateString()}</div>
          </div>
        `
      })
    } else {
      listenTbody.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding: 12px; font-size: 13px;">No recent listens</div>'
    }

    document.getElementById('user-modal').classList.add('active')
  } catch (err) {
    alert('Failed to load user details: ' + err.message)
  }
}

async function fetchInsights() {
  try {
    const trackRes = await apiRequest('/insights/top-tracks')
    const searchRes = await apiRequest('/insights/top-searches')
    
    const tracks = Array.isArray(trackRes) ? trackRes : (trackRes.data || [])
    const searches = Array.isArray(searchRes) ? searchRes : (searchRes.data || [])
    
    const tBody = document.getElementById('insights-tracks')
    tBody.innerHTML = ''
    tracks.forEach((t, i) => {
      tBody.innerHTML += `
        <div class="insight-item">
          <div class="insight-rank">#${i + 1}</div>
          <div class="insight-content">
            <div class="insight-title">${t.title || t.id}</div>
          </div>
          <div class="insight-value">${t.playCount || 0} <span class="text-muted" style="font-size: 11px">plays</span></div>
        </div>
      `
    })

    const sBody = document.getElementById('insights-searches')
    sBody.innerHTML = ''
    searches.forEach((s, i) => {
      sBody.innerHTML += `
        <div class="insight-item">
          <div class="insight-rank">#${i + 1}</div>
          <div class="insight-content">
            <div class="insight-title">${s.query}</div>
          </div>
          <div class="insight-value">${s.count} <span class="text-muted" style="font-size: 11px">reqs</span></div>
        </div>
      `
    })
  } catch(e) {
    console.error('Insights failed', e)
  }
}

async function banUser(id) {
  if (!confirm(`Are you sure you want to ban user ${id}?`)) return
  try {
    await apiRequest(`/users/${id}/ban`, 'POST')
    fetchRecentUsers()
  } catch(e) { alert('Ban failed: ' + e.message) }
}

async function unbanUser(id) {
  try {
    await apiRequest(`/users/${id}/ban`, 'DELETE')
    fetchRecentUsers()
  } catch(e) { alert('Unban failed: ' + e.message) }
}

async function fetchLogs() {
  try {
    const res = await apiRequest('/logs')
    const logs = res.data || res || []
    const term = document.getElementById('terminal-output')
    term.textContent = logs.join('\n') || 'No logs yet...'
    term.scrollTop = term.scrollHeight
  } catch (err) {
    console.error('Failed to load logs', err)
  }
}

async function flushCache() {
  if (!confirm('Are you sure you want to flush all server caches? This may cause a temporary spike in API requests.')) return
  try {
    const data = await apiRequest('/cache', 'DELETE')
    alert(`Success: ${data.keysCleared} cache keys cleared.`)
  } catch (err) {
    alert('Failed to flush cache: ' + err.message)
  }
}

async function restartServer() {
  if (!confirm('WARNING: Are you sure you want to hard-restart the server?')) return
  try {
    const data = await apiRequest('/restart', 'POST')
    alert(data.message)
  } catch (err) {
    alert('Restart signal sent, server might be offline now.')
  }
}


function closeUserModal() {
  document.getElementById('user-modal').classList.remove('active')
}

// Required for inline onclick handlers added dynamically
window.closeUserModal = closeUserModal
window.login = login
window.logout = logout
window.fetchStats = fetchStats
window.fetchRecentUsers = fetchRecentUsers
window.fetchProxies = fetchProxies
window.resetProxies = resetProxies
window.addProxy = addProxy
window.removeProxy = removeProxy
window.flushCache = flushCache
window.restartServer = restartServer
window.banUser = banUser
window.unbanUser = unbanUser
window.openUserModal = openUserModal
window.fetchInsights = fetchInsights
window.switchTab = switchTab
