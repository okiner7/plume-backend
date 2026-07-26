module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^https-proxy-agent$': '<rootDir>/tests/__mocks__/https-proxy-agent.js'
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  setupFiles: ['<rootDir>/tests/polyfill.js'],
  transform: {}
};
