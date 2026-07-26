module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/polyfill.js'],
  transform: {},
  projects: [
    {
      // Unit tests: mock the database entirely so workers don't crash
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
      testEnvironment: 'node',
      setupFiles: ['<rootDir>/tests/polyfill.js'],
      moduleNameMapper: {
        '^https-proxy-agent$': '<rootDir>/tests/__mocks__/https-proxy-agent.js',
        '^../../src/services/storage/database$': '<rootDir>/tests/__mocks__/database.js',
        '^../services/storage/database$': '<rootDir>/tests/__mocks__/database.js',
        '^./database$': '<rootDir>/tests/__mocks__/database.js'
      },
      transform: {}
    },
    {
      // Integration & E2E tests: real DB + Redis + full setup
      displayName: 'integration',
      testMatch: [
        '<rootDir>/tests/integration/**/*.test.js',
        '<rootDir>/tests/e2e/**/*.test.js'
      ],
      testEnvironment: 'node',
      setupFiles: ['<rootDir>/tests/polyfill.js'],
      setupFilesAfterFramework: [],
      setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
      moduleNameMapper: {
        '^https-proxy-agent$': '<rootDir>/tests/__mocks__/https-proxy-agent.js'
      },
      transform: {}
    }
  ]
};
