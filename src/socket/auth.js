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

  if (!token || typeof token !== 'string') {
    return next(new Error('Authentication error'))
  }

  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim()
  }

  if (!token) {
    return next(new Error('Authentication error'))
  }

  try {
    const decoded = verify(token)
    if (!decoded) {
      return next(new Error('Authentication error'))
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
    return next(new Error('Authentication error'))
  }
}

module.exports = socketAuthMiddleware
module.exports.socketAuthMiddleware = socketAuthMiddleware
