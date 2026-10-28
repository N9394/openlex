"use strict";
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
process.env.DATABASE_URL = 'file:./test.db';
process.env.LLM_PROVIDER = 'mock';
process.env.ALLOW_MOCK_FALLBACK = 'true';
const originalConsoleError = console.error;
beforeAll(() => {
    console.error = jest.fn();
});
afterAll(() => {
    console.error = originalConsoleError;
});
afterEach(() => {
    jest.clearAllMocks();
});
jest.setTimeout(10000);
//# sourceMappingURL=setup.js.map