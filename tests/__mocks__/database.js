// Mock for src/services/storage/database.js
// Used by unit tests to prevent real MongoDB connection attempts
module.exports = {
  connectPromise: Promise.resolve(),
  client: null,
  getCollection: jest.fn(() => ({
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock-id' }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    createIndex: jest.fn().mockResolvedValue(null),
  })),
}
