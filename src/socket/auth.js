const { verify } = require('../services/auth/jwt')

/**
 * Socket.io Authentication Middleware
 * Extracts JWT token from handshake auth, authorization header, or query parameters.
 * Validates the token and attaches user info to the socket.
 */
function socketAuthMiddleware(socket, next) {
  let token = null

  if (socket.handshake?.auth && socket.handshake.auth.token) {
    token = socket.handshake.auth.token
  } else if (socket.handshake?.headers && socket.handshake.headers.authorization) {
    token = socket.handshake.headers.authorization
  } else if (socket.handshake?.query && socket.handshake.query.token) {
    token = socket.handshake.query.token
  }

  // If no token, allow anonymous connection for ping / server status
  if (!token || typeof token !== 'string') {
    socket.user = null
    socket.userId = null
    return next()
  }

  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim()
  }

  if (!token) {
    socket.user = null
    socket.userId = null
    return next()
  }

  try {
    const decoded = verify(token)
    if (!decoded) {
      socket.user = null
      socket.userId = null
      return next()
    }

    socket.user = decoded

    let userId = null
    if (decoded.provider && decoded.provider_id) {
      userId = `${decoded.provider}_${decoded.provider_id}`
    } else if (decoded.userId) {
      userId = decoded.userId
    } else if (decoded.provider_id) {
      userId = decoded.provider_id
    } else if (decoded.id) {
      userId = decoded.id
    }

    socket.userId = userId

    if (socket.userId) {
      socket.join(socket.userId)
    }

    return next()
  } catch (err) {
    // On verification error, allow anonymous connection
    socket.user = null
    socket.userId = null
    return next()
  }
}

module.exports = socketAuthMiddleware
