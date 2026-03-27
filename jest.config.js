/**
 * @file jest.config.js
 * @description Jest configuration for Node.js ESM environment.
 */

export default {
  testEnvironment: 'node',
  transform: {}, // No transformation needed for native ESM in Node.js
  verbose: true
};
