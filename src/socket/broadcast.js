let ioInstance = null

/**
 * Initialize the broadcaster with a Socket.io server instance.
 * @param {import('socket.io').Server} io 
 */
function initBroadcaster(io) {
  ioInstance = io
}

/**
 * Broadcast an event and payload to all connected clients.
 * @param {string} event 
 * @param {any} payload 
 */
function broadcast(event, payload) {
  if (ioInstance) {
    ioInstance.emit(event, payload)
  }
}

/**
 * Send an event and payload to a specific user room.
 * @param {string} userId 
 * @param {string} event 
 * @param {any} payload 
 */
function sendToUser(userId, event, payload) {
  if (ioInstance && userId) {
    ioInstance.to(userId).emit(event, payload)
  }
}

module.exports = {
  initBroadcaster,
  broadcast,
  sendToUser
}
