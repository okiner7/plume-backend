const { Server } = require('socket.io')
const socketAuthMiddleware = require('./auth')
const { initBroadcaster, broadcast, sendToUser } = require('./broadcast')

let io = null

/**
 * Initialize Socket.io server attached to an HTTP server instance.
 * @param {import('http').Server} httpServer 
 * @param {object} corsOptions 
 * @returns {import('socket.io').Server}
 */
function initSocketServer(httpServer, corsOptions) {
  const options = {}
  if (corsOptions) {
    options.cors = corsOptions
  }

  io = new Server(httpServer, options)

  // Apply authentication middleware
  io.use(socketAuthMiddleware)

  // Initialize broadcaster with io instance
  initBroadcaster(io)

  // Socket connection handlers
  io.on('connection', (socket) => {
    // Handle ping test for CLI tool / diagnostic verification
    socket.on('ping_test', (data) => {
      socket.emit('pong_test', { ...data, receivedAt: Date.now() })
    })
  })

  return io
}

module.exports = {
  initSocketServer,
  initSocket: initSocketServer,
  init: initSocketServer,
  setupWebSocket: initSocketServer,
  broadcast,
  sendToUser
}
