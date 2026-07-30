class AppError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.statusCode = status
  }
}

module.exports = AppError
